#!/usr/bin/env python3
"""Package a production iPad/tvOS build for recipient-side signing.

Build Release for generic/platform=iOS with CODE_SIGNING_ALLOWED=NO first.
This tool changes only a temporary copy and verifies platform-specific assets,
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
PROBE_MARKERS = (b"--device-quality-probe", b"--rife-playback-probe", b"--rife-stability-probe", b"PlaybackValidation", b"UpdateValidation", b"RifeStabilityValidation")


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


def verify_tv_resources(app):
    web = app / "Web"
    presets = json.loads((web / "quality_presets.json").read_text())
    require([p["id"] for p in presets] == ["tigerest-default", "tigerest-liveaction", "tigerest-aggressive-test", "tv-balanced"], "Missing TV quality presets")
    checked = 0
    for relative in {s for p in presets for s in p["shaders"]}:
        path = (web / relative).resolve()
        source = (ROOT / "resources/mpv" / relative).resolve()
        require(path.is_relative_to(web.resolve()) and source.is_relative_to((ROOT / "resources/mpv/shaders").resolve()), "Shader path escapes resource directory")
        require(path.is_file() and digest(path) == digest(source), f"TV shader differs: {relative}")
        checked += 1
    for bundled, source in [
        ("SubtitleFonts/SourceHanSansSC-Regular.otf", "apple/Resources/SubtitleFonts/SourceHanSansSC-Regular.otf"),
        ("Web/licenses/SourceHanSans-LICENSE.txt", "apple/Resources/SubtitleFonts/LICENSE.txt"),
        ("Web/third_party_licenses.txt", "resources/misc/licenses.txt"),
        *[(f"home-art/{name}.png", f"native/home-art/{name}.png") for name in ["anime", "movies", "series", "favorites"]],
    ]:
        require((app / bundled).is_file() and digest(app / bundled) == digest(ROOT / source), f"TV resource differs: {bundled}")
        checked += 1
    require(not (app / "RifeModel").exists(), "TV package must not contain RIFE models")
    require(not list(app.rglob("tv-fixture*")), "TV fixture media cannot be released")
    return checked


def package(app, output, version, platform="ipad", minimum_installation_os=None):
    app = app.resolve()
    output = output.resolve()
    require(app.suffix == ".app" and app.is_dir(), "Expected an existing .app directory")
    require(output != app and not output.is_relative_to(app), "Output directory must be outside the input app")
    require(re.fullmatch(r"\d+\.\d+\.\d+", version), "Expected a stable three-part version")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    require(subprocess.run(["git", "diff", "--quiet", "HEAD", "--"], cwd=ROOT).returncode == 0, "Commit tracked source changes before generating and building release resources")
    info = plistlib.loads((app / "Info.plist").read_bytes())
    require(info.get("CFBundleShortVersionString") == version, "Application version differs from release version")
    require(platform in {"ipad", "tvos"}, "Unsupported platform")
    television = platform == "tvos"
    require(info.get("CFBundleIdentifier") == f"top.tigerest.theater.{'tv' if television else 'ipad'}", "Unexpected application identifier")
    require(info.get("CFBundleSupportedPlatforms") == ["AppleTVOS" if television else "iPhoneOS"], "Only matching device builds can be packaged")
    require(info.get("UIDeviceFamily") == [3 if television else 2], "Unexpected device family")
    require(info.get("MinimumOSVersion") == "26.0", "Expected input deployment target 26.0")
    require(minimum_installation_os in {None, "15.0"} and not (television and minimum_installation_os), "Installation metadata override applies only to iPad")
    require((app / "Assets.car").is_file() and info.get("CFBundleIcons", {}).get("CFBundlePrimaryIcon"), "Application icon missing")
    if television:
        require(info.get("TVTopShelfImage", {}).get("TVTopShelfPrimaryImageWide"), "TV Top Shelf artwork missing")
    else:
        require(info.get("CFBundleIcons~ipad", {}).get("CFBundlePrimaryIcon", {}).get("CFBundleIconFiles"), "iPad icon metadata missing")
    require(not list(app.rglob("*.debug.dylib")) and not list(app.rglob("__preview.dylib")), "Debug/preview build cannot be released")
    require(not list(app.rglob("*.xctest")), "Test bundles cannot be released")
    if not television:
        for name in ["SourceHanSansSC-Regular.otf", "LICENSE.txt"]:
            source = ROOT / "apple/Resources/SubtitleFonts" / name
            bundled = app / "SubtitleFonts" / name
            require(bundled.is_file() and digest(bundled) == digest(source), f"iPad subtitle font resource differs: {name}")
    executable = info.get("CFBundleExecutable", "")
    require(executable and Path(executable).name == executable, "Invalid application executable")
    output.mkdir(parents=True, exist_ok=True)
    ipa = output / f"TigerestTheater-{version}-{platform}.ipa"
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
            platform_id = "3" if television else "2"
            legacy_command = "LC_VERSION_MIN_TVOS" if television else "LC_VERSION_MIN_IPHONEOS"
            require((platforms and all(value == platform_id for value in platforms)) or legacy_command in commands, f"Non-device binary in app: {relative}")
            binaries.append(relative)
        require(executable in binaries, "Main executable is not Mach-O")
        binary = (copied / executable).read_bytes()
        require(b"mpv-version" in binary, "Player missing")
        web = verify_manifest(copied / "Web", "files")
        require(web["revision"] == revision, "Resource source revision is stale; regenerate and rebuild at the release commit")
        if television:
            require(b"tigerest-rife" not in binary, "TV package unexpectedly links RIFE")
            resources_verified = verify_tv_resources(copied)
            model = {"compiled_sha256": {}}
        else:
            require(b"tigerest-rife" in binary, "Native RIFE missing")
            resources_verified = len(web["files"])
            model = verify_manifest(copied / "RifeModel", "compiled_sha256")
            require(model.get("runtime_pipeline") == "split-coarse-metal", "Unexpected RIFE pipeline")
            require(model.get("weights_sha256") == json.loads((ROOT / "dev/macos/rife/model_source.json").read_text())["files"]["train_log/flownet.pkl"], "Unexpected RIFE weights")
        if minimum_installation_os:
            # Metadata-only redistribution; do not change Mach-O deployment targets.
            info["MinimumOSVersion"] = minimum_installation_os
            (copied / "Info.plist").write_bytes(plistlib.dumps(info, fmt=plistlib.FMT_BINARY))
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
            "platform": platform,
            "minimum_installation_os": info["MinimumOSVersion"],
            "built_deployment_target": "26.0",
            "older_os_runtime_validated": False,
            "architecture": "arm64",
            "signing": "unsigned; recipient must sign before device installation",
            "embedded_provisioning_profiles": 0,
            "signing_certificates_or_private_keys": 0,
            "removed_signing_files": removed,
            "binaries": binaries,
            "native_rife": not television,
            "rife_files_verified": len(model["compiled_sha256"]),
            "resources_verified": resources_verified,
            "source_revision": revision,
            "web_source_revision": web["revision"],
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
    parser.add_argument("--platform", choices=["ipad", "tvos"], default="ipad")
    parser.add_argument("--minimum-installation-os", choices=["15.0"], help="iPad plist-only override; does not establish runtime compatibility")
    arguments = parser.parse_args()
    try:
        package(arguments.app, arguments.output.resolve(), arguments.version, arguments.platform, arguments.minimum_installation_os)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"IPA packaging failed: {error}\n")
