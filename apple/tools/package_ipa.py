#!/usr/bin/env python3
"""Package a production iPad build for recipient-side signing, never distribution signing.

Build Release for generic/platform=iOS with CODE_SIGNING_ALLOWED=NO first.
This tool changes only a temporary copy, requires native RIFE and verified assets,
and emits an unsigned IPA plus a non-personal validation report.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
MACHO_MAGIC = {bytes.fromhex(value) for value in (
    "feedface", "cefaedfe", "feedfacf", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"
)}
PROBE_MARKERS = (b"--device-quality-probe", b"--rife-playback-probe", b"PlaybackValidation", b"UpdateValidation")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_manifest(directory, key):
    manifest = json.loads((directory / "manifest.json").read_text())
    entries = manifest[key]
    require(bool(entries), f"Empty {directory.name} manifest")
    for name, expected in entries.items():
        path = (directory / name).resolve()
        require(path.is_relative_to(directory.resolve()), "Manifest path escapes bundle")
        require(path.is_file() and digest(path) == expected, f"Resource hash mismatch: {directory.name}/{name}")
    return manifest


def package(app, output, version):
    app = app.resolve()
    output = output.resolve()
    require(app.suffix == ".app" and app.is_dir(), "Expected an existing .app directory")
    require(output != app and not output.is_relative_to(app), "Output directory must be outside the input app")
    require(re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a stable three-part version")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    require(info.get("CFBundleShortVersionString") == version, "Application version differs from release version")
    require(info.get("CFBundleIdentifier") == "top.tigerest.theater.ipad", "Unexpected application identifier")
    require(info.get("CFBundleSupportedPlatforms") == ["iPhoneOS"], "Only device builds can be packaged")
    require(info.get("UIDeviceFamily") == [2], "Expected an iPad-only build")
    require(info.get("MinimumOSVersion") == "26.0", "Expected minimum iPadOS 26.0")
    require(not list(app.rglob("*.debug.dylib")) and not list(app.rglob("__preview.dylib")), "Debug/preview build cannot be released")
    executable = info.get("CFBundleExecutable", "")
    require(executable and Path(executable).name == executable, "Invalid application executable")
    output.mkdir(parents=True, exist_ok=True)
    ipa = output / f"TigerestTheater-{version}-ipad.ipa"
    require(not ipa.exists(), "Output already exists; choose a clean output directory")
    with tempfile.TemporaryDirectory(prefix="tigerest-unsigned-ipad-") as temporary:
        stage = Path(temporary)
        payload = stage / "Payload"
        copied = payload / app.name
        shutil.copytree(app, copied, symlinks=True)
        removed = []
        for path in sorted(copied.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            if path.name in {"_CodeSignature", "embedded.mobileprovision", ".DS_Store"} or path.suffix in {".mobileprovision", ".provisionprofile"}:
                removed.append(str(path.relative_to(copied)))
                if path.is_dir() and not path.is_symlink():
                    shutil.rmtree(path)
                else:
                    path.unlink()
        binaries = []
        for path in copied.rglob("*"):
            relative = str(path.relative_to(copied))
            if path.is_symlink():
                require(path.resolve().is_relative_to(copied), f"Symlink escapes bundle: {relative}")
                continue
            if not path.is_file():
                continue
            require(path.suffix.lower() not in {".p12", ".pfx", ".p8", ".key", ".cer", ".p7b", ".p7c", ".entitlements", ".xcconfig", ".xcuserstate"}, f"Private build material in bundle: {relative}")
            data = path.read_bytes()
            require(b"-----BEGIN PRIVATE KEY-----" not in data and b"-----BEGIN RSA PRIVATE KEY-----" not in data and b"-----BEGIN EC PRIVATE KEY-----" not in data, f"Private key in bundle: {relative}")
            if data[:4] not in MACHO_MAGIC:
                continue
            require(not any(marker in data for marker in PROBE_MARKERS), f"Validation probe in production binary: {relative}")
            signed = subprocess.run(["codesign", "--display", str(path)], capture_output=True)
            if signed.returncode == 0:
                subprocess.run(["codesign", "--remove-signature", str(path)], check=True, capture_output=True)
            unsigned = subprocess.run(["codesign", "--display", str(path)], capture_output=True)
            require(unsigned.returncode != 0 and b"not signed at all" in unsigned.stderr, f"Binary is not cleanly unsigned: {relative}")
            architectures = subprocess.check_output(["lipo", "-archs", str(path)], text=True).strip()
            require(architectures == "arm64", f"Unexpected binary architecture: {relative}: {architectures}")
            commands = subprocess.check_output(["otool", "-l", str(path)], text=True)
            require(all(value == "0" for value in re.findall(r"^\s*cryptid\s+(\d+)", commands, re.MULTILINE)), f"Encrypted binary cannot be re-signed: {relative}")
            platforms = re.findall(r"^\s*platform\s+(\S+)", commands, re.MULTILINE)
            require((platforms and all(value == "2" for value in platforms)) or "LC_VERSION_MIN_IPHONEOS" in commands, f"Non-device binary in app: {relative}")
            binaries.append(relative)
        require(executable in binaries, "Main executable is not Mach-O")
        binary = (copied / executable).read_bytes()
        require(b"tigerest-rife" in binary and b"mpv-version" in binary, "Player or native RIFE missing")
        web = verify_manifest(copied / "Web", "files")
        model = verify_manifest(copied / "RifeModel", "compiled_sha256")
        require(model.get("runtime_pipeline") == "split-coarse-metal", "Unexpected RIFE pipeline")
        require(model.get("weights_sha256") == json.loads((ROOT / "dev/macos/rife/model_source.json").read_text())["files"]["train_log/flownet.pkl"], "Unexpected RIFE weights")
        require(not list(copied.rglob("_CodeSignature")) and not list(copied.rglob("*.mobileprovision")), "Signing material remains")
        # Write regular ZIP entries ourselves so Finder metadata, ACLs, resource
        # forks and source xattrs can never be carried into the distribution.
        staged_ipa = stage / ipa.name
        with zipfile.ZipFile(staged_ipa, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for path in sorted(payload.rglob("*")):
                if path.is_dir() and not path.is_symlink():
                    continue
                name = str(path.relative_to(stage))
                entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                entry.create_system = 3
                entry.compress_type = zipfile.ZIP_DEFLATED
                if path.is_symlink():
                    entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                    archive.writestr(entry, os.readlink(path))
                else:
                    mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
                    entry.external_attr = (stat.S_IFREG | mode) << 16
                    archive.writestr(entry, path.read_bytes())
        with zipfile.ZipFile(staged_ipa) as archive:
            require(archive.testzip() is None, "IPA ZIP integrity check failed")
            require(all(name.startswith("Payload/") and "__MACOSX" not in name for name in archive.namelist()), "Unexpected archive metadata")
        report = {
            "asset": ipa.name,
            "sha256": digest(staged_ipa),
            "bytes": staged_ipa.stat().st_size,
            "version": version,
            "build": info["CFBundleVersion"],
            "minimum_ipados": info["MinimumOSVersion"],
            "architecture": "arm64",
            "signing": "unsigned; recipient must sign before device installation",
            "embedded_provisioning_profiles": 0,
            "signing_certificates_or_private_keys": 0,
            "removed_signing_files": removed,
            "binaries": binaries,
            "native_rife": True,
            "rife_files_verified": len(model["compiled_sha256"]),
            "web_files_verified": len(web["files"]),
            "source_revision": web["revision"],
            "installation_or_playback_tested": False,
        }
        shutil.move(staged_ipa, ipa)
        (output / (ipa.name + ".validation.json")).write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--version", default=(ROOT / "VERSION").read_text().strip())
    arguments = parser.parse_args()
    try:
        package(arguments.app, arguments.output.resolve(), arguments.version)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"IPA packaging failed: {error}\n")
