# iPad opt-in probes

These sources are **not** part of the generated normal app. Use the Xcode 27 beta toolchain and existing local Personal Team settings. Never place signing identities, device IDs, credentials, or real server media URLs in source or probe reports.

## RIFE

`RIFE/build_probe.py --model <verified Mac model directory> --output <temporary directory>` creates an isolated Objective-C++ application project. Build target `TigerestTheater` for iphoneos with Automatic Signing. The probe checks six 1080p interpolation results and writes `Library/Caches/rife-ipad-probe.json`.

The development bundle ID is shared with the player solely to use its existing provisioning profile. Installing this probe temporarily replaces the executable; it does not read or delete Profiles. After collecting the report, always rebuild and reinstall the normal player. Core ML inference alone is not a successful end-to-end video interpolation test.

## Quality and system controls

Generate the normal project, then run `Quality/prepare.py` and build. The opt-in `PLAYBACK_VALIDATION` compilation condition includes the extra source. Launch with **both** `--ui-testing --device-quality-probe` and `-TigerestPlaybackGesturesSeen YES`. It only uses UITestProfiles and locally generated fixtures copied to `Library/Caches/device-fixture.mp4`.

For the SSim downscale case, also supply `--downscale-probe` and `Library/Caches/device-fixture-4k.mp4`. Reports are `quality-probe.json` and `quality-probe-downscale.json` in Caches. Verify actual shader pass descriptions, hot reset/reapply, audio output, and brightness/volume restoration. Simulator screen brightness and system volume are unsupported; device verification is required.

Run `apple/tools/generate_project.py` again to remove all validation sources/flags, then build, verify signing, reinstall, and launch without test arguments. Do not deliver the probe build to the user as the normal app.

## Playback RIFE and PC danmaku parity

Prepare native RIFE with `apple/tools/prepare_native_rife.py` before generating the project. This verifies the exact mpv commit and compiled model hashes, and preserves the pinned SPM artifacts. See `docs/apple/2026-10-14-ipad-feedback-verification.md` for supported formats and ABI constraints.

Add `--rife-playback-probe` to the quality probe launch arguments. Supply locally generated Caches fixtures `device-rife-1080.mp4` (12 s, 1080p/24, BT.709 SDR, AAC), `device-fixture.mp4` (720p/30), and `device-rife-long.mp4` (60 s). The report `rife-playback.json` checks actual filter output, audio, seek, EOF, shader coexistence and sustained memory. `baseline.png` / `rife-native.png` capture decoded/rendered playback frames via `screenshot-raw`; no production media is used.

For the request pipeline, use `--danmaku-parity-probe` instead. It replaces only the isolated test model's URLSession with URLProtocol fixtures: every request is intercepted, including mapping writes, and no real credentials are used. Inspect `danmaku-parity.json`; all twenty cases must succeed. `apple/Tests/pc_danmaku_golden.py` separately executes the shipped PC Lua matcher and official-header builder (LuaJIT required) and generates the cross-language matching and signature-digest oracles consumed by AppleCore tests.

Always restore the normal project and app after either probe, as described above.

## Danmaku display cadence

Use `--danmaku-frame-probe` with the quality probe arguments and the local 720p/30 `device-fixture.mp4`. It imports 1200 generated comments into UITestProfiles and reports `danmaku-frames.json`: callback and movement FPS, p95 interval, pause freeze, ±300 ms seeks and 2× speed. This measures application rendering cadence, not compositor presentation or production-stream performance. Always restore and launch the normal app afterward.


## Danmaku glyphs and production read-only check

`--danmaku-glyph-probe` renders the same CJK/Latin text using the old attributed stroke, plain fill, production silhouette/fill renderer and a color-range control. `danmaku-glyph-comparison.png` preserves that row order; `danmaku-glyph.json` must have zero damaged opaque interior pixels. Run on a physical device with CJK fonts; the minimal simulator image lacks those fonts.

`--bluebox-live-probe` is explicitly different from the network-isolated parity fixture. It makes anonymous GET requests to the configured public NAS API for 青之箱 S1E1 search, release details and comments, and writes `bluebox-live.json`. It does not read production Profiles, send credentials or submit any shared correction. A failed online result must be reported separately from fixture results. Restore the normal app afterward.
