# Android Client Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. User approved the design and explicitly requested implementation on 2026-10-06; execute continuously in this session.

**Goal:** Deliver a working Android 15+ client reusing Tigerest web UI, messages, comments and settings, with bundled mpv, danmaku and responsive foldable/tablet layouts.

**Architecture:** Independent Kotlin application under `android/`. A origin-scoped WebKit transport adapts existing web plugins to packaged mpv JNI and platform settings. Native video and danmaku share playback time, while window metrics and folding features drive layout.

**Tech Stack:** Kotlin, Gradle, Android SDK 36, AndroidX WebKit/WindowManager, libmpv, Node contract tests, Android instrumentation.

**Spec:** `docs/superpowers/specs/2026-10-06-android-client-design.md`

## Global Constraints

- minSdk 35, compile/target SDK 36; arm64-v8a and x86_64 runtime packages.
- Existing web code is the source of truth; generated assets are not manually edited.
- API positions/durations/offsets use milliseconds; libmpv properties use seconds.
- No desktop credentials or device unlock information in test fixtures, logs or artifacts.
- Device 24072PX77C is foldable: inner and outer panels have different resolutions; query metrics on each transition, preserve each panel's existing density; never copy one panel override to the other.
- Check every `.so` and packaged ZIP for 16 KB alignment; report runtime test separately.
- Production comments/read-state mutations are excluded from testing; test fixture account has isolated data.

## Review Focus

- Late load/end/error events after replacing a video must not stop the new video: Task 3 session tests.
- Reverse-proxy paths and redirects must not expand trusted origins: Task 2 URL and transport tests.
- Folding during typing/playing must retain draft/route/time while recalculating layout: Task 7 device checks.
- Seeking/pausing/buffering/b倍速 must resynchronize danmaku without replaying stale requests: Task 6 timeline tests.
- A source failure or unread endpoint failure must preserve usable web/player state: Task 5 fixture checks.

### Task 1: Reproducible Android build and native runtime

Files: `android/settings.gradle.kts`, `build.gradle.kts`, `app/build.gradle.kts`, `tools/bootstrap.py`, `native-runtime.lock.json`, `gradlew*`, `.gitignore`.
Produces: Gradle application `top.tigerest.theater`, debug suffix `.debug`, fixed runtime assets including upstream JNI namespace `is.xyz.mpv.MPVLib`.
- [x] Download pinned runtime, verify pinned locally computed SHA-256 of official artifact, extract ABI libraries and JNI binding with attribution.
- [x] Prepare portable JDK/SDK/Gradle outside repository; record sources; compile smoke package.
- [x] Validate runtime ELF load segments are aligned to 16384 or greater; reject invalid native candidate.
- [x] Commit reproducible build tooling and lock manifest.

### Task 2: Web bootstrap, origin-scoped transport and connection UI

Files: `android/app/src/main/assets/androidBridge.js`, `WebHost.kt`, `BridgeDispatcher.kt`, `tests/test_android_bridge.cjs`, `native/nativeshell.js`.
Consumes: bundled native scripts; produces `window.apiPromise` and API methods/signals compatible with current web plugins.
- [x] Write Node tests asserting argument forwarding, response rejection, signal disconnect, stale-context cancellation and normalized server paths.
- [x] Run them and observe failure before implementing transport.
- [x] Implement document-start injection and per-origin WebMessage transport; bridge has explicit operation allowlist.
- [x] Generate shared assets from `native/`; implement trusted onboarding URL, server address persistence and HTTP(S) validation.
- [x] Run transport tests and existing shared JS tests, then commit.

### Task 3: Real libmpv playback and web integration

Files: `PlaybackController.kt`, `MpvSurface.kt`, `PlaybackState.kt`, `PlaybackStateTest.kt`, `androidPlayerUi.js`.
Consumes: `load(url,options,metadata,audio,subtitle)` and typed controls; produces existing player signals in milliseconds plus native state.
- [x] Add state tests: generation replacement ignores stale end, milliseconds convert correctly, stop distinct from EOF, paused state retained.
- [x] Observe failure, implement serialized controller, mpv observer, Surface attach/detach and lifecycle ownership.
- [x] Implement touch controls, Emby progress events, track selection/external subtitles, audio focus and foreground audio service as needed.
- [x] Exercise genuine video rendering, seek, audio, subtitles, speed and repeated load/stop on USB device; commit.

### Task 4: Functional platform settings

Files: `SettingsStore.kt`, `settings.android.json`, `SettingsStoreTest.kt`, shared settings capability hooks.
Produces: `settings.setValue/resetToDefault`, snapshot and section signals; supported values apply to mpv/danmaku.
- [x] Test value bounds, reset, persistence and unsupported setting rejection before implementation.
- [x] Filter desktop-only settings and map supported values to Android playback properties.
- [x] Verify settings page search, categories, immediate update and reopening persistence; commit.

### Task 5: Shared messages/comments and full web fixture

Files: `android/tests/fixture-server.cjs`, `android/tests/device-web.cjs`, shared asset generation and narrow compatibility changes.
Consumes: original `community*.js`/`embycompat.js`; no reimplementation of the service trust rules.
- [x] Bring up isolated server fixture and expose via `adb reverse`; use complete message/comment payloads.
- [x] Test existing messages/replies/sent/paging/read-all/anchor and comment draft/send/reply/delete flows, including cancellation and authentication errors.
- [x] Fix compatibility failures in platform boundaries and rerun original shared JS checks; commit.

### Task 6: Danmaku data and frame-independent rendering

Files: `danmaku/DanmakuRepository.kt`, `DanmakuTimeline.kt`, `DanmakuOverlay.kt`, `DanmakuTimelineTest.kt`, `androidDanmakuUi.js`.
Produces: auto match/search/episode list and comments, per-source enabled/delay history, JSON/XML/ASS import, shared style application.
- [x] Test literal timeline examples for pause, seek, speed and stale item, plus top/bottom/scroll records and source delay.
- [x] Observe failure, implement network matching from Emby metadata and parsers with controlled input sizes.
- [x] Implement Choreographer overlay, lane collision avoidance, source/style controls and persistence.
- [x] Verify synchronized overlay during real mpv playback and fixture search/failure paths; commit.

### Task 7: Foldable windows, insets and native lifecycle

Files: `MainActivity.kt`, `WindowLayoutController.kt`, `androidResponsive.css`, device instrumentation.
Consumes: current WindowMetrics, FoldingFeature, insets, playback controller; produces CSS safe area/hinge and reflow without page reload.
- [x] Use real WebView/device window and IME checks plus literal layout unit tests to assert compact/wide classifications and keyboard-safe input bounds.
- [x] Implement resizable unlocked orientation, configuration handling, display changes, fold feature collection and restoration.
- [x] Record both physical panels; test device-state panel switching, rotation, real freeform resizing, simulated phone/tablet bounds, settings and comment typing; report unperformed dual-app split screen separately.
- [x] Test API35/36 and 16KB emulator where available; restore original device settings, commit.

### Task 8: Review, delivery and explicit verification report

Files: `android/README.md`, `docs/reports/2026-10-06-android-client.md`, distributable APK/checksums/licenses.
- [x] Run Node suite, Gradle unit tests/Lint, instrumentation, packaged native alignment and USB regression.
- [x] Fresh whole-branch review per executing-plans; fix significant findings with reproducing tests.
- [x] Build APK, install isolated debug variant on device, save artifact SHA-256 and exact covered/uncovered validation.
- [x] Commit and deliver source, APK and report without claiming unperformed tests.

## Execution record

Implemented and verified; source is kept in the managed worktree on `codex/android-client`. The detailed results, review fixes, rulings and remaining validation boundaries are recorded in `docs/reports/2026-10-06-android-client.md`. API35/16KB emulator was attempted but unavailable; authenticated production playback/writes await a dedicated account. Checkmarks record completion of the implementation/testing action, not certification of those unperformed runtime scenarios.
