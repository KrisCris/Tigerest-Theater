"""Stage release-pinned mpv DLLs without changing the developer's system deps."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

DEFAULT_LOCK = Path(__file__).with_name("mpv-runtime-lock.json")


def prepare(output, lock_file=DEFAULT_LOCK, artifacts=None, archive_file=None):
    output = Path(output).resolve()
    if output.exists():
        raise ValueError("Output must not already exist")
    lock = json.loads(Path(lock_file).read_text(encoding="utf-8"))
    if lock["schemaVersion"] != 1:
        raise ValueError("Unsupported lock schema")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".mpv-runtime-", dir=output.parent) as temporary:
        stage = Path(temporary)
        release_archive = None
        if not artifacts and "archive" in lock:
            archive_info = lock["archive"]
            if archive_file:
                release_archive = Path(archive_file)
            else:
                subprocess.run(["gh", "release", "download", archive_info["releaseTag"],
                                "--repo", "Tigerest/Tigerest-Theater", "--pattern", archive_info["assetName"],
                                "--dir", str(stage)], check=True, timeout=600)
                release_archive = stage / archive_info["assetName"]
            with release_archive.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if release_archive.stat().st_size != archive_info["size"] or digest != archive_info["sha256"]:
                raise ValueError("Kernel archive checksum/size mismatch")
        for role, filename in (("primary", "libmpv-2.dll"), ("fallback", "libmpv-fallback.dll")):
            item = lock[role]
            if artifacts:
                source = Path(artifacts[str(item["artifactId"])])
                host_sha = (source / "host-source-sha.txt").read_text().strip()
                shutil.copyfile(source / "libmpv-2.dll", stage / filename)
            else:
                archive = release_archive or stage / (str(item["artifactId"]) + ".zip")
                if not archive.exists():
                    with archive.open("wb") as stream:
                        subprocess.run(["gh", "api", f"repos/Tigerest/Tigerest-Theater/actions/artifacts/{item['artifactId']}/zip"],
                                       stdout=stream, check=True, timeout=600)
                # Only read these exact members, never extract archive paths.
                with zipfile.ZipFile(archive) as package:
                    host_sha = package.read("host-source-sha.txt").decode("ascii").strip()
                    with package.open("libmpv-2.dll") as source, (stage / filename).open("wb") as destination:
                        shutil.copyfileobj(source, destination, 1024 * 1024)
            if host_sha != item["hostSourceSha"]:
                raise ValueError(f"{role} kernel build source mismatch")
            target = stage / filename
            with target.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if target.stat().st_size != item["size"] or digest != item["sha256"]:
                raise ValueError(f"{role} kernel checksum/size mismatch")
        # Publish only validated runtime files, not downloaded archives.
        result = stage / "verified"
        result.mkdir()
        for filename in ("libmpv-2.dll", "libmpv-fallback.dll"):
            (stage / filename).rename(result / filename)
        shutil.copyfile(lock_file, result / "mpv-runtime-lock.json")
        result.rename(output)
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--artifacts", type=Path, help="Offline JSON map of artifact IDs to locally verified directories")
    parser.add_argument("--archive", type=Path, help="Offline copy of the release-pinned kernel archive")
    args = parser.parse_args()
    mapping = json.loads(args.artifacts.read_text(encoding="utf-8")) if args.artifacts else None
    if args.artifacts and args.archive:
        parser.error("Choose either --artifacts or --archive")
    print(prepare(args.output, args.lock, mapping, args.archive))
