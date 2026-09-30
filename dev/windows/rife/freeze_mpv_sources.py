"""Resolve source revisions before the two Windows mpv builds start."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess
import tempfile

SNAPSHOT = "2026-08-09T00:00:00Z"
MPV_SHA = "dd5d17d3285a095a0f712fa9d116e22a076492de"


def resolve(entry):
    name, repository, ref = entry
    if name.endswith("/mpv.cmake"):
        sha = MPV_SHA
    elif re.fullmatch("[0-9a-fA-F]{40}", ref):
        sha = ref
    elif repository.startswith("https://github.com/"):
        project = repository[19:].removesuffix(".git")
        command = ["gh", "api", "repos/" + project + "/commits", "--method", "GET",
                   "-f", "until=" + SNAPSHOT, "-f", "per_page=1"]
        if ref:
            command += ["-f", "sha=" + ref]
        commits = json.loads(subprocess.check_output(command, text=True))
        if not commits:
            raise ValueError("No revision at build date: " + repository)
        sha = commits[0]["sha"]
    else:
        with tempfile.TemporaryDirectory(prefix="rife-pin-") as temp:
            command = ["git", "-c", "gc.auto=0", "-c", "maintenance.auto=false", "clone", "--bare", "--filter=tree:0", "--single-branch", "--no-tags"]
            if ref:
                command += ["--branch", ref]
            subprocess.run(command + [repository, temp], check=True, capture_output=True)
            sha = subprocess.check_output(["git", "-C", temp, "log", "-1", "--format=%H",
                                           "--before=" + SNAPSHOT, "HEAD"], text=True).strip()
    if not re.fullmatch("[0-9a-fA-F]{40}", sha):
        raise ValueError("Invalid source revision: " + repository)
    print(name, sha, flush=True)
    return name, {"repository": repository, "originalRef": ref, "sourceSha": sha}


def recipe_entries(recipe):
    entries = []
    for file in sorted(recipe.rglob("*.cmake")):
        text = file.read_text(encoding="utf-8")
        repository = re.search(r'GIT_REPOSITORY\s+("[^"\n]+"|\S+)', text)
        if repository:
            tag = re.search(r'GIT_TAG\s+("[^"\n]+"|\S+)', text)
            reset = re.search(r'GIT_RESET\s+("[^"\n]+"|\S+)', text)
            entries.append((file.relative_to(recipe).as_posix(), repository[1].strip('"'),
                            reset[1].strip('"') if reset else tag[1].strip('"') if tag else ""))
    return entries


def verify_lock(entries, lock):
    if any(lock.get(key) != value for key, value in {'schemaVersion': 1, 'snapshot': SNAPSHOT,
        'mpvSourceSha': MPV_SHA, 'rustToolchain': 'nightly-2026-08-08'}.items()):
        raise ValueError('Incompatible pinned mpv source lock')
    sources = lock.get('sources', {})
    if set(sources) != {name for name, _, _ in entries}:
        raise ValueError('Pinned source lock does not cover the original recipe')
    for name, repository, ref in entries:
        entry = sources[name]
        sha = entry.get('sourceSha', '')
        if entry.get('repository') != repository or entry.get('originalRef') != ref or not re.fullmatch('[0-9a-f]{40}', sha):
            raise ValueError('Mismatched pinned source: ' + name)
        if name.endswith('/mpv.cmake') and sha != MPV_SHA:
            raise ValueError('Mismatched mpv source revision')
        if re.fullmatch('[0-9a-fA-F]{40}', ref) and sha.lower() != ref.lower():
            raise ValueError('Pinned revision conflicts with recipe: ' + name)
    return lock


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--verify-lock", type=Path)
    args = parser.parse_args()
    entries = recipe_entries(args.recipe)
    if args.verify_lock:
        result = verify_lock(entries, json.loads(args.verify_lock.read_text(encoding='utf-8')))
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            sources = dict(pool.map(resolve, entries))
        result = {"schemaVersion": 1, "snapshot": SNAPSHOT, "mpvSourceSha": MPV_SHA,
                  "rustToolchain": "nightly-2026-08-08", "sources": sources}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
