# macOS RIFE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an optional, self-contained RIFE interpolation feature for Apple Silicon, choosing the Core ML execution configuration from measured correctness and real-time performance.

**Architecture:** A standalone native inference engine is validated before integration. A bundled VapourSynth adapter supplies adjacent decoded frames to that engine; mpv keeps ownership of playback, timestamps, audio and rendering. A small controller owns only this feature's filter and temporary decode settings.

**Tech Stack:** C++/Objective-C++, Core ML, optional Metal kernels, VapourSynth C API, Qt 6, libmpv; isolated Python/PyTorch/coremltools for model conversion only.

**Spec:** `docs/superpowers/specs/2026-09-29-macos-rife-design.md` (approved in this conversation).

**Base:** Online `main` verified as `7044cb47a1213c72ad2e8d9ca823700614d26edb`, including native macOS keyboard fixes. Worktree: `macos-rife`. Preserve uncommitted work in the original checkout. Execution requested in the current conversation with “开始吧…以最新的版本为基底构建”.

## Global Constraints

- Apple Silicon/macOS; retain the current deployment floor, macOS 26.0.
- Default off; 2× SDR progressive CFR input at most 30 fps. HDR, VFR and unsupported sources bypass interpolation.
- Preserve rational frame durations, original dimensions and supported SDR bit depth.
- One active model, one inference in flight, at most two pending input pairs; private disk cache capped at 512 MiB.
- Correctness targets: each reference sample PSNR ≥40 dB and MAE ≤0.005, finite outputs only.
- Initial gate: 1080p 30→60 fps, warm pair-processing p95 ≤26.7 ms; full-player 10-minute run with drops <0.1% and steady A/V offset ≤40 ms.
- Thirty inference calls are warmup; two consecutive 3-second windows of inference-related underperformance disable interpolation for the current item.
- Ship models and dependencies; no Homebrew, SVP or external Python requirement. No claims of ANE use without runtime evidence.
- Use independent test profiles and binaries. Keep README limited to user instructions and actual limitations.

## Review Focus

- Fractional frame rates and the final unpaired frame must preserve total duration (Task 4).
- Seeks and format changes must discard old frame results without reusing stale image state (Tasks 3–5).
- Unknown color properties or 10-bit/HDR input must not silently become 8-bit SDR (Tasks 3–4).
- Other filters and user-owned decoding options must survive enable/disable and failures (Task 5).
- Moved bundles and clean environments must load only included inference dependencies (Task 6).

## File Structure

| Location | Responsibility |
| --- | --- |
| `dev/macos/rife/` | Pinned build requirements, source/weight acquisition, conversion, reference fixtures, benchmark orchestration |
| `src/player/interpolation/` | Native engine, qualification policy, controller, VS plugin; each in separate files |
| `resources/mpv/rife/` | Thin `.vpy` adapter; no model weights in Qt resources |
| `Contents/Resources/rife/` | Installed compiled models and provenance manifest |
| `tests/test_rife_*.{py,cpp,mm}` | Numerical, policy, timing and playback regression tests |
| `build/rife/` | Ignored environments, large weights, benchmark outputs and profiling traces |

### Task 1: Reproducible reference model and conversion

**Files:** Create `dev/macos/rife/requirements-build.txt`, `model_source.json`, `prepare_model.py`, `convert_model.py`; test `tests/test_rife_conversion.py`.

**Interfaces:** `prepare_model(destination: Path) -> Path` returns a verified model directory. `convert_model(source: Path, output: Path, width: int, height: int, scale: float) -> Path` returns a saved Core ML package plus a JSON manifest. Manifest contains model identifier, upstream revision, original weight SHA-256, tool versions, tensor names/layout/dtypes and padded dimensions. No auto-download at application runtime.

- [x] Write a conversion test with identical frames and translated synthetic content; assert exact output dimensions, finite values, PSNR ≥40 dB and MAE ≤0.005 versus the same PyTorch weights.
- [x] Run the test to establish a missing-model/converter failure before implementation.
- [x] Fetch official 4.25 lite weights and associated source; record and verify hashes, pin tested conversion dependencies in an isolated environment.
- [x] Implement conversion for fixed dimensions using public Core ML operations. Preserve reference warp coordinates/padding; use CPU PyTorch for the reference to avoid backend-dependent baselines.
- [x] Run a small-size correctness check before larger conversions. Emit diagnostic images and metrics when parity fails; fix conversion rather than relax the gate silently.
- [x] Commit source, tests and provenance metadata; exclude environments and generated weights.

### Task 2: Native performance and execution-device gate

**Files:** Create `dev/macos/rife/benchmark.mm`, `benchmark.py`; test `tests/test_rife_benchmark.py`.

**Interfaces:** Native CLI accepts `--model PATH --input-a PATH --input-b PATH --compute all|cpu-ane|cpu-gpu --warmup 30 --iterations N --output PATH`; consumes planar float tensor fixtures and manifest from Task 1. Emits JSON with load time, p50/p95 pair time, generated frames, peak memory, model/config identity and device-plan metadata; writes a numerical output for parity. `evaluate_gate(report: dict) -> dict` returns pass/fail and explicit reasons, never infers ANE execution from a configuration name.

- [x] Add tests rejecting missing samples, p95 >26.7 ms, NaN output and a fabricated ANE claim based only on compute units.
- [x] Run those tests and record expected failure before adding the benchmark/gate implementation.
- [x] Compile the Objective-C++ harness with the installed command-line SDK; load the model once, reuse inputs and benchmark each public compute configuration independently.
- [x] Test 1080p and 4K, starting from small shapes to bound memory. Compare reduced flow-grid candidates without reducing output dimensions; recheck numerical parity against the corresponding reference mode.
- [x] Collect ANE runtime evidence using available Core ML/Neural Engine profiling tools. If Xcode first-launch is incomplete, continue numerical/timing work and clearly mark device execution unverified.
- [x] Save measured results and gate decision. If none of the routes meet the initial gate, finish the reproducible investigation and report the blocker; do not implement or publish a misleading live-playback toggle.
- [x] Commit the harness and tests, keeping device-specific logs under `build/rife/`.

### Task 3: Reusable native inference engine

**Files:** Create `src/player/interpolation/RifeEngine.h`, `RifeEngine.mm`, `RifeTypes.h`; modify relevant CMake files; test `tests/test_rife_engine.mm`.

**Interfaces:** `FrameView {const float* planes[3]; size_t strides[3]; int width,height;}`; `FrameBuffer` owns three float planes of matching dimensions. `EngineConfig {modelDirectory, computePolicy, width, height}`. `RifeEngine::create(const EngineConfig&) -> unique_ptr<RifeEngine>`, `interpolate(const FrameView&, const FrameView&, float timestep) -> FrameBuffer`; errors are reported as typed exceptions caught by the adapter. `timestep` is 0.5 in the first shipping path.

- [x] Add tests for wrong dimensions, reference agreement, repeated calls, release/reload on format change and full-precision output preservation.
- [x] Run them against the missing engine and confirm failure.
- [x] Extract only the validated inference path from Task 2. Keep preprocessing and optional Metal helpers separate from model/session ownership.
- [x] Reuse one model and buffers; release old format instances. Mark the interface non-concurrent and enforce single-call access in its owner.
- [x] Run engine tests and repeat the native timing check only after changes affecting timing.
- [x] Commit the independently tested engine.

### Task 4: Streaming interpolation adapter

**Files:** Create `src/player/interpolation/RifeVsPlugin.cpp`, `FrameTiming.h/.cpp`, `resources/mpv/rife/interpolate.vpy`; test `tests/test_rife_timing.cpp`, `tests/test_rife_vapoursynth.py`.

**Interfaces:** VS entry `VapourSynthPluginInit2`; filter `tigerest.RIFE(clip, model_path, compute_policy)` accepts validated SDR frames. `splitDuration(num, den)` returns two normalized equal rational durations; `sourceFramesForOutput(n)` returns the adjacent input indices needed for output frame `n`. Diagnostics count actual synthesized frames, cut bypasses and prediction errors.

- [ ] Write timing tests for 24000/1001 and 30000/1001 input, last-frame handling and unchanged aggregate duration. Add plugin tests for reference output, cut boundaries and HDR/unknown-metadata bypass.
- [ ] Establish failures with the adapter absent.
- [ ] Implement adjacent-frame-only requests within mpv's bounded input window; never reopen the media URL or seek from inside the filter.
- [ ] Preserve frame metadata and original-frame order, split durations for inserted frames, and handle the last frame without requesting beyond EOF.
- [ ] Add scene-cut detection with deterministic fixtures; preserve the boundary frame instead of mixing shots. Validate matrix/range conversions against known SDR fixtures.
- [ ] Run real plugin tests with the Task 3 model and mpv filter integration; verify inserted-frame content, not only reported fps.
- [ ] Commit plugin, script and tests.

### Task 5: Playback control and user setting

**Files:** Create `src/player/interpolation/FrameInterpolationController.h/.cpp`, `InterpolationPolicy.h/.cpp`; modify `PlayerComponent.cpp/.h`, `MpvConfigManager.cpp`, settings JSON and diagnostics; test `tests/test_rife_policy.cpp`, `tests/test_rife_controller.cpp`.

**Interfaces:** `SourceInfo {width,height,fpsNum,fpsDen,progressive,cfr,hdr,colorKnown}`; `qualify(SourceInfo) -> Eligibility {enabled,reason}`. Controller states `Off`, `Preparing`, `Active`, `Bypassed`, `DisabledForCurrentItem`. Methods `beginItem`, `onSeek`, `onFormatChanged`, `stop`, `onMetrics`; each invalidating event advances a generation counter. Filter label is `tigerest-rife`.

- [ ] Add policy/state tests covering every excluded input class, pending results after seek, filter ownership, two slow windows, and exclusion of pause/network buffering from the performance rule.
- [ ] Run and confirm they fail before adding the controller.
- [ ] Implement the states and generation checks; keep preparation/inference off the UI thread, limit queued pairs to two.
- [ ] Add the default-off setting with exact spec help text and next-open semantics. Apply copy-back decoding only for the owned session, restoring only values still owned by this feature.
- [ ] Avoid the default SVP discovery endpoint for built-in RIFE sessions, preserve explicit user configuration, and bypass when an external interpolation chain is detected.
- [ ] Expose a short actual-status message and one notification on fallback. Keep model/backend metrics in diagnostics.
- [ ] Run unit tests plus real load/seek/pause/EOF/filter-conflict playback tests and commit.

### Task 6: Self-contained macOS packaging

**Files:** Adapt `dev/macos/bundle_vapoursynth.py`, `CMakeModules/CompleteBundleMac.cmake.in`, `.github/workflows/build-macos.yml`, `dev/macos/bundle.sh`; extend `tests/test_macos_bundle.py`.

**Interfaces:** Package manifest resolves the VS runtime, native plugin and compiled RIFE model relative to the bundle; writable registration/cache paths resolve under application data. Bundle paths never embed the build machine's Homebrew prefix.

- [ ] Add a package test that fails on a missing model/plugin, escaping path, external dylib or use of preexisting Python/VS registration.
- [ ] Preserve useful earlier runtime packaging work by applying only selected files from the original checkout. Fix the Python launcher indirection exposed by the existing incomplete packaging test.
- [ ] Bundle validated model artifacts, plugin, minimum Python/VS runtime and dependency licenses. Sign nested Mach-O files after dependency rewriting, then sign the app.
- [ ] Test a relocated app with spaces/Chinese in its path and a clean environment/config directory. Verify that actual playback uses the bundled runtime and produces interpolated frames.
- [ ] Commit packaging and its test coverage.

### Task 7: End-to-end qualification and delivery

**Files:** Add `tests/test_rife_playback.cjs`; update the user-facing README after capabilities are measured; keep full reports in ignored build output.

- [ ] Run the existing CTest suite on the new upstream base with the feature disabled, then run feature integration cases with isolated profiles.
- [ ] Run the 10-minute 1080p acceptance fixture, A/V flash/pulse check, 4K qualification and HDR bypass checks; export reproducible benchmark metadata and real generated-frame counts.
- [ ] Compare measured backend behavior, retaining GPU mode when it is superior and reporting ANE use only with evidence. Record power results only when actually measured under comparable conditions.
- [ ] Review the complete branch for timing, lifetime, dependency and latest-upstream integration mistakes; fix material findings and re-run affected checks.
- [ ] Build and validate an ARM64 DMG, checksum and install-style smoke test. Recheck online main before final integration and reconcile any intervening changes.
- [ ] Publish only a qualified feature build under a new version, with concise capability/limitation notes; attach any created PR to this chat.

## Review of this plan

The initial performance gate intentionally precedes playback/UI work. The spec's runtime limits, fractional timestamps, fallback behavior, configuration ownership, isolated tests and clean-package requirements each have an owning task above. Tests and thresholds are distinct from unmeasured claims; no RIFE performance result is assumed by this plan.

## Verified baseline and execution status

- The online `main` reference was checked again after the build and remains `7044cb47a1213c72ad2e8d9ca823700614d26edb`.
- Release configuration and compilation succeeded in `/tmp/tigerest-rife-build-20260929` using the existing Qt 6.9.3 SDK.
- CTest passed all 17 targets, including the updated native macOS keyboard tests. Two individual SVP socket cases were skipped because another running player owns `/tmp/mpvsocket`; that process was left untouched.
- Full logs are retained under ignored `build/rife/baseline/` in this worktree. No product-code changes have been made here.
- Execution approved in chat. Tasks 1–2 are complete: the fp32 half-grid candidate passed the 1080p inference gate (p95 21.12 ms on this M4 Pro); full playback remains unqualified. 4K quarter-grid p95 47.52 ms failed the 30→60 fps budget. Xcode-beta 27.2 was found in Downloads with its license accepted; a Core AI trace verified 1,350 RIFE ANE prediction intervals for the slower hybrid candidate. The selected FP32 path uses GPU. Device logs stay under ignored `build/rife/`.
