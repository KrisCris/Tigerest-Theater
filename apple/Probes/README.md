# iPad opt-in probes

These sources are **not** part of the generated normal app. Use the Xcode 27 beta toolchain and existing local Personal Team settings. Never place signing identities, device IDs, credentials, or real server media URLs in source or probe reports.

## RIFE

`RIFE/build_probe.py --model <verified Mac model directory> --output <temporary directory>` creates an isolated Objective-C++ application project. Build target `TigerestTheater` for iphoneos with Automatic Signing. The probe checks six 1080p interpolation results and writes `Library/Caches/rife-ipad-probe.json`.

The development bundle ID is shared with the player solely to use its existing provisioning profile. Installing this probe temporarily replaces the executable; it does not read or delete Profiles. After collecting the report, always rebuild and reinstall the normal player. Core ML inference alone is not a successful end-to-end video interpolation test.

## Quality and system controls

Generate the normal project, then run `Quality/prepare.py` and build. The opt-in `PLAYBACK_VALIDATION` compilation condition includes the extra source. Launch with **both** `--ui-testing --device-quality-probe` and `-TigerestPlaybackGesturesSeen YES`. It only uses UITestProfiles and locally generated fixtures copied to `Library/Caches/device-fixture.mp4`.

For the SSim downscale case, also supply `--downscale-probe` and `Library/Caches/device-fixture-4k.mp4`. Reports are `quality-probe.json` and `quality-probe-downscale.json` in Caches. Verify actual shader pass descriptions, hot reset/reapply, audio output, and brightness/volume restoration. Simulator screen brightness and system volume are unsupported; device verification is required.

Run `apple/tools/generate_project.py` again to remove all validation sources/flags, then build, verify signing, reinstall, and launch without test arguments. Do not deliver the probe build to the user as the normal app.
