# Apple interaction increment integration plan

> Execute inline with `superpowers:executing-plans`; keep the existing isolated worktree and independent test profiles. The user has explicitly authorized integration, fixes, builds, and validation without another approval step.

**Goal:** Integrate Windows `4db34c7ae424e5c1d58d3d28ac4f1eb2e5503664` with Apple `433a528`, implement equivalent iPad server selection transactions, and validate Mac, iPad, and native tvOS.

**Architecture:** Preserve shared HomeMotion and its existing visual design. Use the delivered Qt transaction. Keep iPad's native chooser; stage a fresh WKWebView with the same profile data store, commit its address and replace the old host only after successful document loading, and retain the old host on cancellation/failure. Native tvOS remains separate from shared JS.

**Tech Stack:** Qt 6.9.3 / JavaScript / SwiftUI / WKWebView / AppleCore / Xcode-beta 27.2.

**Spec:** `docs/verification/2026-10-19-mac-interaction-code-handoff.md`, `docs/verification/2026-10-19-mac-animation-followup.md`, and `docs/superpowers/plans/2026-10-19-jellyfin-interaction-parity.md`; later code handoff supersedes older ownership/status paragraphs.

## Global constraints

- Reuse the attached isolated worktree; leave the original repository and installed profiles unchanged. No push, main-branch integration, or publication.
- Preserve Apple subtitle/session fixes and all incoming changes. Resolve overlapping snapshot fixes by behavior and actual v0 regression evidence.
- Preserve 720ms poster motion, WebKit native blur, safe areas, and reduced-motion preferences.
- Record fixture/API/actual playback separately. Keep credentials, device/signing identities, and private media out of exports.
- Use Xcode-beta through process-level DEVELOPER_DIR. Device builds and isolated applications retain existing minimum OS 26.0.
- New Android toolbar feedback is explicitly absent from this snapshot; inspect Apple geometry, record any reproduction, and do not invent an upstream fix.

## Review focus

1. API success followed by HTTP403, disconnected HTML, cancellation, or profile switch must not persist a wrong server or erase the old page/session.
2. Candidate WK documents must not dispatch native side effects before commit; stale navigation results must not affect a newer selection.
3. Successful replacement must start with no old server history while preserving profile-scoped website credentials.
4. Real v0 polyfill input activation and cached snapshot scroll restoration must both remain correct.
5. Modern/Legacy favorites, nested season/episode returns, rapid back, viewport changes, and missing poster routes must finish without an input-blocking layer.

### Task 1: Integrate and pin the shared snapshot

Files: merge the 38 upstream files; resolve `native/jellyfinPlugin.js`, `tests/test_jellyfin_compat.js`, and the chronological verification log. Reconcile `native/homeTransitions.js` and its cache regression.

- [ ] Verify all archive hashes, bundle prerequisite, and target ref; merge on `codex/jellyfin-290-apple-interaction-4db34c7`.
- [ ] Use upstream visible-tab fallback and `is`-attribute sanitization, retain both visible-page/hash-route regressions and iPad cache-scroll coverage.
- [ ] Run Node compatibility/motion/onboarding suites, actual-polyfill/cache Chrome tests, then affected Qt CTest targets after rebuilding. Expected: zero failures; inspect failures before changing source.
- [ ] Commit the merge and record the exact SHA.

### Task 2: iPad server selection transaction

Files: `apple/App/AppModel.swift`, `WebHost.swift`, `NativeBridge.swift`, `SettingsStore.swift`, `TigerestApp.swift`, `OnboardingView.swift`, `apple/Resources/ipadBridge.js`; regression fixtures and `apple/UITests/WebHostTests.swift`.

Interfaces: `finishServerSelection(server, mode, target)` validates same-origin HTTP(S), stages the target, and commits only after the main document succeeds. `takeServerSelectionError()` consumes real failure state. Native `connect` uses the same transaction. A staged WebHost queues native requests until activation, reports HTTP/network/process failures, and can be cancelled. Settings update address/mode atomically; the new view identity clears old history.

- [ ] Add controlled successful/HTTP403/disconnected/delayed server pages and UI assertions for cancel, rollback, retry, saved address/mode, old page/session retention, bridge availability, and history isolation. Run against old Apple code and observe failure.
- [ ] Implement the transaction with generation/profile/cancellation guards; preserve native address input and its typed text on rotation/cancel.
- [ ] Run Apple bridge tests, AppleCore, UI transaction tests on simulator and physical iPad, existing bridge lifecycle and playback regression. Expected: all pass, including real HTML failures after PublicInfo200.
- [ ] Commit Apple adaptation with its test evidence.

### Task 3: Three-platform interaction and playback validation

Files: private external evidence scripts, repository result document, UI regression tests only where needed.

- [ ] Regenerate all bundled resources and build Mac/iPad/tvOS. Test actual Qt server-selection cancellation, failed HTML recovery, successful switching, and persistent relaunch.
- [ ] On actual Jellyfin 10.11.11 and 12.2 Modern/Legacy: slow login; home→library→detail→back; home→detail→library→home; series/season/episode parent chain; favorites; rapid back/resize/rotation; no persistent motion layers.
- [ ] Inspect visible poster flight and WebKit blur, collect first/repeated transition metrics and layout geometry; compare controlled Emby samples where available, documenting unequal media scale and unsupported timing APIs.
- [ ] Verify iPad native URL keyboard symbols/language/rotation and compact/wide detail geometry. Test native TV navigation/remote playback separately. Reuse baseline five-version evidence only for unchanged paths, and rerun shared-change-sensitive login/navigation plus playback smoke.
- [ ] Diagnose and fix actual failures, run affected regressions, and record exact pass/fail/untested boundaries.

### Task 4: Review, production-format artifacts, and return

- [ ] One independent whole-branch review, with privacy-safe source/tests/spec/ledger only. Resolve material findings and rerun affected tests.
- [ ] Commit final source; regenerate resources at that HEAD. Build normal Release iPad/tvOS unsigned IPAs and ad-hoc Mac DMG; verify resource revision, font/RIFE rules, signature/dependencies, and isolated packaged playback.
- [ ] Export incremental Git bundle from both known parent lines, Apple patch, exact source/hash manifest, redacted evidence, commands, and limitations to the shared folder. Read back hashes/ZIP CRC. Stop owned services and restore temporary preferences.
