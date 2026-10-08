# Shared danmaku and report diagnostics implementation plan

> **For agentic workers:** Implement independent domains with superpowers:dispatching-parallel-agents, then integrate and review. Steps use checkbox syntax for tracking.

**Goal:** Integrate the updated NAS mapping and private report attachment contracts on desktop and Android.

**Architecture:** Shared mapping lookup precedes existing automatic/local matching, with safe legacy fallback. Only explicit user choices calibrate the server, using an optional private local write credential. Report submission freezes one bounded native-redacted snapshot and one attachment UUID, creates the report, and then independently uploads/retries that snapshot.

**Tech stack:** Qt/C++, mpv/Lua, Kotlin/OkHttp, shared JavaScript/WebChannel, native/Node/Lua/JVM/browser fixtures.

**Spec:** `X:/danmaku-mapping-api.md` and `X:/community-api.md`, supplied 2026-10-09. Copies under `docs/` travel with this implementation.

## Global constraints

- Mapping POST `/api/tigerest/v1/danmaku`: request <=16 KiB, connection 5 s, total 35 s; only trusted NAS origins.
- Original work title, season 1–1000, episode 1–10000; unknown season and special numbering use legacy flow. No arithmetic on episode IDs.
- Mapping write credential is optional, private, absent from public builds/logs; third-party endpoints retain legacy behavior.
- Report POST remains <=16 KiB. Diagnostics PUT follows successful report ID, with exactly clientRequestId, capturedAt UTC Z, truncated Boolean, logText.
- Diagnostics UTF-8 text <=1048576 bytes, JSON <=8388608 bytes; no controls except LF/CR/TAB or invalid Unicode. Default enabled, cancellable, latest ~10 minutes of current account/profile application logs only.
- Capture and UUID once, retry attachment only; preserve report success on partial failure. Account changes/cancellation abort and erase snapshots; respect independent 429 cooldown and stop on 401/409.
- Preserve previous platform, minute/second, RIFE Alt+1 and danmaku fallback fixes. No public release or installed-profile modifications.
- Read Windows testing instructions and dot-source test environment in the same PowerShell invocation before native tests/CTest.

## Review focus

- Playback or account changes while a response is pending must never apply stale data or write calibration for the replacement item.
- Encoded/escaped/multiline secrets, credentials, private identity and absolute paths must not reach attachments; malformed large log lines must remain bounded.
- Attachment timeout, 429, 503 or conflict must not create duplicate reports or recapture logs on retry.
- Explicit user selection must retain both catalog and episode IDs, use original source identity, and fall back to chosen legacy comments without claiming shared save.
- Unknown season, third-party endpoint, unavailable mapping and missing write credential must preserve existing matching and playback.

### Task 1: Shared mapping on desktop and Android

**Files:** `resources/mpv/plugins/uosc_danmaku/`, Android DanmakuRepository/VideoControls and private configuration helpers; runtime/JVM fixtures.
**Interfaces:** Original source metadata already supplied by native player. Produce trusted-origin lookup and explicit manual-selection flows, preserving full danmaku response and generation checks. Private `mappingWriteToken` configured outside normal exported settings.

- [x] Add failing tests for lookup precedence, exact original identity, manual-only saves, private credential/third-party handling, fallback and stale playback.
- [x] Implement read-first lookup, complete-response loading, manual POST replacing GET, graceful chosen-ID legacy fallback and shared provenance.
- [x] Run Lua/runtime and JVM fixtures, inspect generated request bodies and prove no numeric ID arithmetic.

### Task 2: Native bounded diagnostics collection

**Files:** `src/utils/ReportDiagnostics.*`, Log/SystemComponent; Android bounded diagnostic logger plus bridge/player/web hooks; native/JVM tests.
**Interfaces:** `api.system.setReportDiagnosticsScope(key, callback)` updates in-memory account boundary; `api.system.collectReportDiagnostics(callback)` returns `{capturedAt,truncated,logText}` or empty/unavailable. Scope key is never logged. Collection is native-redacted before exposure to JavaScript. Android methods support both Promise and callback through the existing bridge.

- [x] Add failing sanitizer, byte-bound, time/account/profile isolation and control/Unicode tests.
- [x] Implement bounded desktop current-profile reading and Android private application ring/file logging; restrict scope, sanitize robustly, return one snapshot.
- [x] Expose bridge methods and instrument application errors, playback and matching clues without raw account identities.
- [x] Run native and JVM tests, verify log absence/unreadable results allow plain reports.

### Task 3: Shared report attachment client and UI

**Files:** `native/communityClient.js`, `native/communityMessages.js`, existing/new Node and browser fixtures.
**Consumes:** Task 2 system methods above. **Produces:** `createReportDiagnostics(snapshot)` immutable validated attachment payload and `uploadReportDiagnostics(reportId,payload)` with separate cooldown.

- [x] Add failing client/UI fixtures for default opt-in, opt-out/unavailable collection, POST-then-PUT, unchanged snapshot/UUID, partial-success retry, independent 429, 401/conflict and cancellation.
- [x] Implement contract validation, separate upload lifecycle, success/partial-success text and attachment-only retry. Never display raw backend errors or logs in the form.
- [x] Run Node and desktop/Android bridge browser fixtures; retain all platform and minute/second assertions.

### Task 4: Integration and verification

**Files:** Native/JVM test registration, contract copies, CHANGELOG, verification notes and preview artifacts.

- [x] Build updated Windows native binaries and Android debug/release assets with no embedded secrets.
- [x] Run Windows full CTest after proper dependency setup, Android unit/lint/build, and isolated report UI fixtures.
- [x] Review all diffs for authentication, stale-response, privacy and retry mistakes; fix and rerun affected checks.
- [x] Produce preview packages and document fixture versus production read-only and real-playback evidence. Do not publish or replace installed player.
