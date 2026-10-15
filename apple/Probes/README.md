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

## Sustained RIFE and playback speed

Host regression checks: `python3 apple/Tests/test_native_rife_scheduler.py` exercises the real core with a small scheduling fixture and forced conversion failures; `python3 apple/Tests/test_native_rife_async.py --timing` checks the real pinned mpv queues and diagnostic QoS commands. On a Metal-capable Mac with MPVKit artifacts resolved, `python3 apple/Tests/test_native_rife_color.py` compares synthetic NV12 conversion against the pinned swscale, including range, chroma placement, padding, invalid inputs and 1080p frames. These checks do not prove device playback performance. Run them with the same selected Xcode toolchain used by the app.

Add `--rife-stability-probe` to the quality probe arguments to record per-second filter metadata, playback position/speed, decoder/render drops, A/V drift, memory, and thermal state in `Caches/rife-stability.json`. The sequence exercises 1→1.25→1.5→2→1, repeated long presses, and seek recovery. During playback, samples append to `Caches/rife-stability-samples.jsonl`; the full JSON report is serialized only after playback stops. This avoids rewriting a growing JSON document on the main actor each second. `maxSampleMilliseconds` measures sampling cost. `--rife-soak-only-probe` skips the speed/seek sequence after warmup for an independent long-playback check; it does not replace the separate speed-transition test. It uses the local 60-second `device-rife-long.mp4` fixture by default; counters can reset at each loop boundary, so compare consecutive samples within each generation rather than subtracting only phase endpoints.

For sustained testing, supply a continuous 14-minute 1080p/24 BT.709 SDR H.264/AAC file as `Caches/device-rife-continuous.mp4`, then add `--rife-continuous-probe --rife-stability-shader --rife-stability-soak`. This enables the default quality preset, avoids EOF loops, and appends ten minutes at normal speed. `status: collected` means data collection finished, **not** that performance passed. Inspect actual drops, A/V drift, thermal state and memory throughout; verify `speed-bypass` stops inference above 1×, `speed-recovery` briefly passes originals on restoration, and normal speed then resumes interpolation. Callback or nominal output FPS alone does not prove smooth presentation. This is local fixture playback, not production streaming validation.

`--rife-speed-quick-probe` replaces the long speed phases with a warmup and five long-press cycles sampled every 50 ms. Compare `--rife-disabled-control`, normal RIFE, and `--rife-default-audio-buffer-probe` (production-default 200 ms queue) to isolate the restoration transient. `--rife-audio-buffer-probe` explicitly requests 50 ms, an experimental override, not the production default; sustained testing rejected it because of an audio underrun and later frame-drop bursts. Compare consecutive samples around transitions: changing output pixel format resets mpv's render-drop counter. Inspect `Caches/rife-mpv.log` for audio underruns separately. Bluetooth/AirPlay routes need their own device validation.

Run `python3 apple/Tests/test_native_rife_scheduler.py` on macOS/Linux for the isolated production-C-filter scheduler tests with address/undefined-behavior sanitizers. These exercise ownership, backpressure, seek/EOF, and repeated speed restoration with a fake inference bridge; they do not validate Core ML pixels or device performance. The test is also registered with CTest on Unix hosts.

On macOS, after preparing the pinned native RIFE headers and resolving MPVKit into `apple/DerivedData`, run `python3 apple/Tests/test_native_rife_async.py` with the same Xcode toolchain. This links the real MPVKit filter graph and bounded queues to a deliberately slow fake core, under address/undefined-behavior sanitizers. It verifies nonblocking delivery/metadata reads, ordered EOF, empty/short streams, byte-limited prefill for large passthrough frames, bounded backpressure, seek invalidation and destruction during inference. `--direct` intentionally bypasses the async wrapper and must fail the blocking regression. This macOS integration test is separate from the portable core scheduler test and does not validate device presentation or Core ML pixels.

The production async wrapper keeps conversion and inference on a private worker graph. Its input queue is limited to two frames / 64 MiB and output queue to four frames / 128 MiB. Playback starts draining when either output limit is reached, or input EOF arrives, so short clips and large unsupported frames cannot wait forever for a four-frame prefill. Seek/reset clears both queues and resets the worker before accepting a new generation. These bounds add a small startup reserve; they cannot compensate indefinitely for inference slower than the source frame interval.

## Read-only production performance trace

After preparing the quality probe, launch with `--device-quality-probe --playback-performance-trace` **without** `--ui-testing`. This is a separate, opt-in observer of user-started playback, not a fixture test: it preserves the selected profile and all player preferences, makes no requests itself, and never starts or stops media. `Caches/playback-performance.jsonl` records allowlisted performance counters every two seconds for at most an hour. It excludes account data, titles, media URLs, request headers and paths. GPU pass timings are aggregated every twenty seconds; each sample measures its own collection cost. The probe-only `TIGEREST_RIFE_TIMING` flag additionally measures conversion and the entire filter processing interval, since `inferenceMs` excludes hardware download/conversion and the final bridge copy. Archive each capture before launching again (launch truncates the file). Restore the normal app after collection. Do not treat this diagnostic build as a release or change preferences to conceal drops.

Optional `--rife-qos-experiment` adds a bounded, in-session scheduling comparison: default QoS for 60 active seconds, user-initiated for 120, default for 120, user-initiated for 180, then default. Paused/buffering time is excluded. This mode intentionally changes only the private RIFE worker scheduling class; it does not change saved preferences, video speed, shaders or the model. `qos-request` is an asynchronous request, not proof of application: check `workerQoS` and `workerQoSError` in following samples. The allowlisted `probe-qos` filter command exists only in timing builds; ordinary tracing does not set QoS. Split wall/CPU conversion timings and downloaded pixel format distinguish scheduling waits from conversion cost. Run the real MPVKit integration with `--timing` to verify worker-side changes and invalid-mode rejection before device use.

## Danmaku display cadence

Use `--danmaku-frame-probe` with the quality probe arguments and the local 720p/30 `device-fixture.mp4`. It imports 1200 generated comments into UITestProfiles and reports `danmaku-frames.json`: callback and movement FPS, p95 interval, pause freeze, ±300 ms seeks and 2× speed. This measures application rendering cadence, not compositor presentation or production-stream performance. Always restore and launch the normal app afterward.


## Danmaku glyphs and production read-only check

`--danmaku-glyph-probe` renders the same CJK/Latin text using the old attributed stroke, plain fill, production silhouette/fill renderer and a color-range control. `danmaku-glyph-comparison.png` preserves that row order; `danmaku-glyph.json` must have zero damaged opaque interior pixels. Run on a physical device with CJK fonts; the minimal simulator image lacks those fonts.

`--bluebox-live-probe` is explicitly different from the network-isolated parity fixture. It makes anonymous GET requests to the configured public NAS API for 青之箱 S1E1 search, release details and comments, and writes `bluebox-live.json`. It does not read production Profiles, send credentials or submit any shared correction. A failed online result must be reported separately from fixture results. Restore the normal app afterward.

## iPad release checks

`--update-probe` uses an isolated settings/defaults domain. `update-validation.json` checks request coalescing, throttling, persisted skip and startup settings, manual override during an unfinished automatic request, HTTP failures and the response size bound. Its last row separately performs an anonymous, read-only GitHub release request; this is not an installation or distribution test. Always restore the normal app after collecting the report.

Release selection follows the PC stable-tag rules, but requires an iPad asset named `TigerestTheater-<version>-ipad.ipa`, an exact URL under this repository's release tag, a positive bounded size and a SHA-256 digest. Desktop/Android assets do not count as iPad releases. The development build only checks and opens release notes; free Personal Team installation continues through Xcode. No IPA is downloaded or installed by this path.
