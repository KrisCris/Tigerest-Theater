"""Validate a private RIFE runtime, then probe it with its own Python process."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import subprocess
import uuid


class RuntimeErrorDetail(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def private_path(root, relative):
    if not isinstance(relative, str) or not relative or "\x00" in relative:
        raise RuntimeErrorDetail("file-path", "Invalid runtime file path")
    win = PureWindowsPath(relative)
    parts = relative.replace("\\", "/").split("/")
    if win.drive or win.root or any(p in ("", ".", "..") or ":" in p for p in parts):
        raise RuntimeErrorDetail("file-path", f"File must be inside runtime: {relative}")
    target = root.joinpath(*parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise RuntimeErrorDetail("file-path", f"File escapes runtime: {relative}")
    for item in (target, *target.parents):
        if item == root:
            break
        if item.is_symlink() or (hasattr(item, "is_junction") and item.is_junction()):
            raise RuntimeErrorDetail("file-path", f"Runtime links are not allowed: {relative}")
    return target


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_manifest(root):
    manifest_path = root / "runtime.json"
    if not manifest_path.is_file():
        raise RuntimeErrorDetail("manifest-missing", f"Private runtime manifest is missing: {root}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise RuntimeErrorDetail("manifest-invalid", str(error)) from error
    if (manifest.get("schemaVersion") != 1 or manifest.get("backend") != "windows-nvidia-trt"
            or not isinstance(manifest.get("runtimeId"), str) or not manifest["runtimeId"]
            or not isinstance(manifest.get("files"), list) or not manifest["files"]):
        raise RuntimeErrorDetail("manifest-invalid", "Unsupported private runtime manifest")
    seen = set()
    for entry in manifest["files"]:
        if not isinstance(entry, dict):
            raise RuntimeErrorDetail("manifest-invalid", "Invalid file entry")
        target = private_path(root, entry.get("path"))
        key = str(target).casefold()
        if key in seen:
            raise RuntimeErrorDetail("file-path", "Duplicate runtime file")
        seen.add(key)
        if not target.is_file():
            raise RuntimeErrorDetail("file-missing", f"Missing runtime file: {entry['path']}")
        if target.stat().st_size != entry.get("size"):
            raise RuntimeErrorDetail("file-size", f"Wrong runtime file size: {entry['path']}")
        if file_hash(target) != entry.get("sha256"):
            raise RuntimeErrorDetail("file-hash", f"Corrupt runtime file: {entry['path']}")
    for path in root.rglob('*'):
        if path.is_file() and path != manifest_path and str(path).casefold() not in seen:
            raise RuntimeErrorDetail('file-unlisted', f'Unverified runtime file: {path.relative_to(root)}')
    return manifest


def isolated_environment(root, manifest):
    # Deliberately exclude PATH, PYTHON*, VS plugin paths and all application
    # credentials. Windows' driver and system DLLs remain available via System32.
    environment = {key: os.environ[key] for key in ("SystemRoot", "WINDIR", "TEMP", "TMP")
                   if key in os.environ}
    environment["PATH"] = str(Path(environment.get("SystemRoot", "C:/Windows")) / "System32")
    environment["VSSCRIPT_PATH"] = str(private_path(root, manifest["entrypoints"]["vsscript"]))
    environment["PYTHONNOUSERSITE"] = "1"
    environment["PYTHONUTF8"] = "1"
    return environment


def probe(root, mpv=None, verify_only=False):
    result = {"ok": False, "stage": "manifest", "manifestValid": False,
              "mpvVersion": None, "vsVersion": None, "trtVersion": None,
              "gpu": None, "loadedLibraries": [], "errors": []}
    try:
        manifest = verify_manifest(root)
        result.update(manifestValid=True, runtimeId=manifest["runtimeId"])
        if verify_only:
            return result
        python = private_path(root, manifest.get("entrypoints", {}).get("python", "python/python.exe"))
        if not python.is_file():
            raise RuntimeErrorDetail("python-missing", "Private Python executable is missing")
        for name in ("vsscript", "plugin", "worker"):
            relative = manifest.get("entrypoints", {}).get(name)
            if not relative or not private_path(root, relative).is_file():
                raise RuntimeErrorDetail("dependency-missing", f"Private {name} is missing")
            if relative not in {entry["path"] for entry in manifest["files"]}:
                raise RuntimeErrorDetail("manifest-invalid", f"Unverified entrypoint: {name}")
        if manifest["entrypoints"]["python"] not in {entry["path"] for entry in manifest["files"]}:
            raise RuntimeErrorDetail("manifest-invalid", "Unverified private Python executable")
        result["stage"] = "runtime"
        command = [str(python), "-B", "-I", "-S", "-X", "utf8",
                   str(private_path(root, manifest["entrypoints"]["worker"])),
                   "--runtime", str(root.resolve())]
        if mpv:
            command += ["--mpv", str(mpv.resolve())]
        process = subprocess.run(command, cwd=root, env=isolated_environment(root, manifest),
                                 capture_output=True, encoding="utf-8", errors="replace", timeout=60,
                                 creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        try:
            worker = json.loads(process.stdout)
        except ValueError as error:
            raise RuntimeErrorDetail("worker-exit", f"Private probe exited {process.returncode}: {process.stderr[-2000:]}") from error
        result.update(worker)
        if process.returncode and not result["errors"]:
            raise RuntimeErrorDetail("worker-exit", f"Private probe exited {process.returncode}")
    except RuntimeErrorDetail as error:
        result["ok"] = False
        result["errors"].append({"code": error.code, "message": str(error)})
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        result["ok"] = False
        result["errors"].append({"code": "probe-failed", "message": str(error)})
    return result


def write_report(path, result):
    path.parent.mkdir(parents=True, exist_ok=True)
    staging = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    staging.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(staging, path)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", type=Path, required=True)
    parser.add_argument("--mpv", type=Path)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    result = probe(args.runtime.resolve(), args.mpv, args.verify_only)
    write_report(args.report, result)
    return 0 if (result["manifestValid"] and args.verify_only) or result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
