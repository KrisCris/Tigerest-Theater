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
            command = ["git", "clone", "--bare", "--filter=tree:0", "--single-branch", "--no-tags"]
            if ref:
                command += ["--branch", ref]
            subprocess.run(command + [repository, temp], check=True, capture_output=True)
            sha = subprocess.check_output(["git", "-C", temp, "log", "-1", "--format=%H",
                                           "--before=" + SNAPSHOT, "HEAD"], text=True).strip()
    if not re.fullmatch("[0-9a-fA-F]{40}", sha):
        raise ValueError("Invalid source revision: " + repository)
    print(name, sha, flush=True)
    return name, {"repository": repository, "originalRef": ref, "sourceSha": sha}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    entries = []
    for file in sorted(args.recipe.rglob("*.cmake")):
        text = file.read_text(encoding="utf-8")
        repository = re.search(r'GIT_REPOSITORY\s+("[^"\n]+"|\S+)', text)
        if repository:
            tag = re.search(r'GIT_TAG\s+("[^"\n]+"|\S+)', text)
            entries.append((file.relative_to(args.recipe).as_posix(), repository[1].strip('"'),
                            tag[1].strip('"') if tag else ""))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        sources = dict(pool.map(resolve, entries))
    result = {"schemaVersion": 1, "snapshot": SNAPSHOT, "mpvSourceSha": MPV_SHA,
              "rustToolchain": "nightly-2026-08-08", "sources": sources}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True), encoding="utf-8")


if __name__ == "__main__":
    main()
