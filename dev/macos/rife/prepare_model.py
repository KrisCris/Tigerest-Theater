"""Fetch hash-pinned official RIFE build inputs; never used by the player."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

SOURCE = json.loads(Path(__file__).with_name("model_source.json").read_text())


def verify_file(path: Path, expected: str) -> None:
    with path.open("rb") as stream:
        actual = hashlib.file_digest(stream, "sha256").hexdigest()
    if actual != expected:
        raise ValueError(f"SHA-256 mismatch for {path.name}: {actual}")


def extract_verified_archive(archive: Path, destination: Path, sha256: str) -> None:
    verify_file(archive, sha256)
    with zipfile.ZipFile(archive) as contents:
        for entry in contents.infolist():
            name = PurePosixPath(entry.filename)
            if name.is_absolute() or ".." in name.parts or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError(f"Unsafe archive path: {entry.filename}")
            if not (destination / entry.filename).resolve().is_relative_to(destination.resolve()):
                raise ValueError(f"Archive path escapes destination: {entry.filename}")
        destination.mkdir(parents=True, exist_ok=True)
        for name in ("train_log/flownet.pkl", "train_log/IFNet_HDv3.py"):
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(contents.read(name))
            verify_file(target, SOURCE["files"][name])


def verify_source(source: Path) -> None:
    for name, digest in SOURCE["files"].items():
        verify_file(source / name, digest)


def prepare_model(destination: Path) -> Path:
    import gdown
    import requests
    archive = destination.parent / "rife-4.25-lite.zip"
    archive.parent.mkdir(parents=True, exist_ok=True)
    if not archive.exists():
        temporary = archive.with_suffix(".download")
        result = gdown.download(id=SOURCE["archive_drive_id"], output=str(temporary))
        if not result:
            raise RuntimeError("Official model download failed")
        verify_file(temporary, SOURCE["archive_sha256"])
        temporary.replace(archive)
    extract_verified_archive(archive, destination, SOURCE["archive_sha256"])
    for name in ("model/warplayer.py", "LICENSE"):
        target = destination / name
        if not target.exists():
            url = f"https://raw.githubusercontent.com/hzwer/Practical-RIFE/{SOURCE['revision']}/{name}"
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            if hashlib.sha256(response.content).hexdigest() != SOURCE["files"][name]:
                raise ValueError(f"SHA-256 mismatch for {name}")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(response.content)
    verify_source(destination)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    print(prepare_model(parser.parse_args().destination))
