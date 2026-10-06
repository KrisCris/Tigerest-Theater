"""Refresh the client part of a verified native source companion for an unchanged runtime."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import tempfile
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--previous", type=pathlib.Path, required=True)
    parser.add_argument("--apk", type=pathlib.Path, required=True)
    parser.add_argument("--output", type=pathlib.Path, required=True)
    args = parser.parse_args()
    repo = pathlib.Path(__file__).resolve().parents[2]
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    if subprocess.check_output(["git", "status", "--porcelain", "--untracked-files=no"], cwd=repo):
        raise SystemExit("Commit tracked source changes before packaging their exact revision")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.previous) as previous, tempfile.TemporaryDirectory() as temporary:
        if previous.testzip():
            raise SystemExit("Previous companion failed CRC verification")
        manifest = json.loads(previous.read("SOURCE-MANIFEST.json"))
        locked = json.loads((repo / "android/native-runtime.lock.json").read_text(encoding="utf-8"))
        if locked != json.loads(previous.read("native-runtime.lock.json")):
            raise SystemExit("Native runtime changed: resolve its corresponding sources before publishing")
        for source in manifest["sources"]:
            data = previous.read("archives/" + source["archive"])
            if len(data) != source["bytes"] or digest(data) != source["sha256"]:
                raise SystemExit("Source archive verification failed: " + source["name"])
        client = next(item for item in manifest["sources"] if item["name"] == "TigerestTheater-client")
        archive = pathlib.Path(temporary) / client["archive"]
        subprocess.run(["git", "archive", "--format=tar", "--output", str(archive), revision], cwd=repo, check=True)
        client_data = archive.read_bytes()
        readme = previous.read("README.md").decode("utf-8")
        old_version = manifest["apk"].removeprefix("TigerestTheater-").removesuffix(".apk")
        new_version = args.apk.name.removeprefix("TigerestTheater-").removesuffix(".apk")
        apk_hash = digest(args.apk.read_bytes())
        readme = readme.replace(old_version, new_version).replace(manifest["apkSha256"], apk_hash).replace(client["version"], revision)
        client.update(version=revision, source=f"https://github.com/Tigerest/Tigerest-Theater/tree/{revision}",
                      bytes=len(client_data), sha256=digest(client_data))
        manifest.update(apk=args.apk.name, apkSha256=apk_hash)
        encoded = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        replacements = {"archives/" + client["archive"]: client_data, "SOURCE-MANIFEST.json": encoded,
                        "README.md": readme.encode("utf-8")}
        with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as result:
            for name in previous.namelist():
                result.writestr(name, replacements[name] if name in replacements else previous.read(name))
        with zipfile.ZipFile(args.output) as result:
            if result.testzip():
                raise SystemExit("New companion failed CRC verification")
        manifest_path = args.output.with_name(args.output.name.removesuffix("-Sources.zip") + "-SOURCE-MANIFEST.json")
        manifest_path.write_bytes(encoded)
        print(json.dumps({"revision": revision, "sources": len(manifest["sources"]), "output": str(args.output),
                          "sha256": digest(args.output.read_bytes())}))


if __name__ == "__main__":
    main()
