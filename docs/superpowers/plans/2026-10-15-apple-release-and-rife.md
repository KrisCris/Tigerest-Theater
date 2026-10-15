# Apple 2.7.0 and iPad sustained RIFE implementation plan

**Goal:** Publish Mac and iPad builds of current 2.7.0 after diagnosing M5 iPad interpolation degradation; begin tvOS work only after both releases are delivered.

**Architecture:** Preserve the patched Qt Mac runtime and shared web resources. Diagnose the existing native iPad mpv/Core ML filter through isolated on-device playback before selecting changes. Keep deployment floors at 26 and existing user profiles intact.

**Authorization:** User explicitly requested latest-code integration, iPad optimization, publication of both platforms, followed by Apple TV development. Routine implementation and publication are already authorized. Reuse the existing attached worktree on `codex/apple-270`.

## Work and acceptance

- [x] Fetch origin/main and release metadata: baseline 355c839, stable release v2.7.0 currently Windows/Android only.
- [x] Build and test Mac with the 2.6.1 patched Qt WebEngine; preserve engine UUID and runtime identities, validate isolated UI and native playback.
- [x] Extend opt-in iPad probe with per-second speed, generated frames, failures, render/decoder drops, A/V sync, memory and thermal state. Measure 1→1.25→1.5→2→1 and long normal-speed playback.
- [x] Compare production CPU/GPU inference with the ANE encoder/refine policy used by the standalone probe. Keep inference precision/model unchanged; select only an improvement supported by measurements.
- [x] Reproduce correctness issues in focused tests before fixes. Exercise discontinuity, seek, EOF, repeated speed/long-press changes and recovery. Do not call nominal output FPS proof of smooth playback.
- [ ] Build normal signed iPad app, restore it after probes; produce unsigned public IPA with no signing identity or profiles. Run AppleCore and shared-resource tests and verify normal project excludes probes.
- [ ] Review, commit, push and merge; append Mac/iPad artifacts to existing v2.7.0 without changing its tag or replacing other-platform files. Record exact source commits, hashes and test limits; verify downloaded files and updater selection.
- [ ] Start separate tvOS design/implementation after publication: native focus-driven browsing and shared playback/core logic, tvOS26+, Siri Remote, physical Apple TV pairing when available.

## Review focus

1. Speed restoration must not leave stale midpoint frames, a stuck filter, or persistent overload.
2. Seek/EOF/reset must preserve monotonically ordered presentation times within each media generation and bounded memory.
3. Thermal/performance fallback must be explicit and recoverable; it must not silently claim interpolated frames while bypassing.
4. Mac runtime packaging must retain the tested display-link and bitmap patches.
5. Public IPA and diagnostics must exclude credentials, device IDs, personal profiles and test entry points.

## Evidence ledger

- Physical baseline reproduced speed overload: 2x A/V drift reached 18.366s. ANE reduced median inference cost and memory but alone still reached 13.501s drift. Speed bypass stopped sustained overload and regenerated fresh frame pairs on normal-speed return.
- ANE + speed safety, default shader, continuous 1080p/24 H.264/AAC: 600-sample normal-speed soak lasted 633.7s, 9 render drops, 0 decoder drops, max A/V drift15.6ms, memory1089.7–1105.6MB, thermal fair/serious. This run preceded the audio-buffer refinement; final-source run is recorded in the release manifest.
- At 50ms sampling, 5 long-press restores with RIFE had26–31 drops and147–193ms transient drift. Reducing audio queue200→50ms produced0–5 drops and13–61ms drift, no underrun log. RIFE-disabled control had4 drops per restore. Keeping RGB format during bypass did not improve restoration and was reverted to avoid extra conversion load.
- Audio queue refinement applies only to RIFE-enabled engine instances. Hardware audio latency and network buffering are unchanged; Bluetooth/AirPlay untested.
- Host filter suite13 cases passed with ASan/UBSan,6000 inputs and50 repeated speed transitions. AppleCore44, bridge5, quality-resource1 passed. Separate code review found no blocking production defects.
- Mac:47 unit/scheduler tests and19 complete-bundle UI fixtures passed. Native gpu-next local60s playback had0 steady drops; RIFE strict performance gate remains unmet (41 drops, old2.6.1 baseline53). Ordinary63-test CTest invocation incorrectly used an undeployed UI executable; discarded those UI results and retained separate deployed-bundle checks.
- Mac baseline test incorrectly rejected a generic owner attribute used legitimately by ambientBackdrop; narrowed assertion in 2b06dfd, targeted test green.
