"""Stage only hash-pinned OpenSSL DLLs from the official CPython archive."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent


def verify(path, entry):
    if not path.is_file() or path.is_symlink():
        raise ValueError("Verified OpenSSL file is missing: " + path.name)
    if path.stat().st_size != entry["size"] or hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
        raise ValueError("Verified OpenSSL checksum/size mismatch: " + path.name)


def prepare(output, archives, offline=False):
    lock = json.loads((HERE / "runtime-lock.json").read_text(encoding="utf-8"))
    if lock["schemaVersion"] != 1:
        raise ValueError("Unsupported OpenSSL runtime lock")
    if output.exists():
        for name, entry in lock["files"].items():
            verify(output / name, entry)
        shutil.copyfile(HERE / "runtime-lock.json", output / "runtime-lock.json")
        shutil.copyfile(HERE / "NOTICE.txt", output / "NOTICE.txt")
        print("Verified existing OpenSSL runtime:", output)
        return
    archive_entry = lock["archive"]
    archives.mkdir(parents=True, exist_ok=True)
    archive = archives / archive_entry["file"]
    if not archive.exists():
        if offline:
            raise ValueError("Offline archive missing: " + archive.name)
        # Never disable TLS verification when obtaining the TLS runtime itself.
        with tempfile.TemporaryDirectory(prefix="openssl-download-", dir=archives) as temporary:
            download = Path(temporary) / archive.name
            print("Downloading", archive_entry["url"], flush=True)
            with urllib.request.urlopen(archive_entry["url"], timeout=60) as response, download.open("wb") as destination:
                shutil.copyfileobj(response, destination)
            verify(download, archive_entry)
            os.replace(download, archive)
    verify(archive, archive_entry)
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="openssl-stage-", dir=output.parent) as temporary:
        staged = Path(temporary) / "runtime"
        staged.mkdir()
        with zipfile.ZipFile(archive) as source:
            for name, entry in lock["files"].items():
                if "member" in entry:
                    (staged / name).write_bytes(source.read(entry["member"]))
                else:
                    shutil.copyfile(HERE / name, staged / name)
                verify(staged / name, entry)
        shutil.copyfile(HERE / "runtime-lock.json", staged / "runtime-lock.json")
        shutil.copyfile(HERE / "NOTICE.txt", staged / "NOTICE.txt")
        os.rename(staged, output)
    print("Prepared verified OpenSSL runtime:", output)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--archives", type=Path, default=HERE.parents[2] / "build/tls-downloads")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    try:
        prepare(args.output.resolve(), args.archives.resolve(), args.offline)
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        parser.exit(1, str(error) + "\n")


if __name__ == "__main__":
    main()
