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
- [x] Build normal signed iPad app, restore it after probes; produce unsigned public IPA with no signing identity or profiles. Run AppleCore and shared-resource tests and verify normal project excludes probes.
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
- Rejected the50ms audio queue after the final soak:186 render drops concentrated late in thermal-serious state and an audio underrun at speed restoration. Restore default200ms and add a bounded original-frame recovery interval instead; Bluetooth/AirPlay untested.
- Host filter suite13 cases passed with ASan/UBSan,6000 inputs and50 repeated speed transitions. AppleCore44, bridge5, quality-resource1 passed. Separate code review found no blocking production defects.
- Mac:47 unit/scheduler tests and19 complete-bundle UI fixtures passed. Native gpu-next local60s playback had0 steady drops; RIFE strict performance gate remains unmet (41 drops, old2.6.1 baseline53). Ordinary63-test CTest invocation incorrectly used an undeployed UI executable; discarded those UI results and retained separate deployed-bundle checks.
- Mac baseline test incorrectly rejected a generic owner attribute used legitimately by ambientBackdrop; narrowed assertion in 2b06dfd, targeted test green.

- Recovery delay added in abad97f:350ms of source frames after leaving>1x, preserving default audio buffering. Host suite expanded to17 cases, red3504 assertions then green, with23–30fps boundaries, repeated switching, seek/EOF and unsupported-source cancellation. Final physical acceptance remains required.

- Physical recovery-delay quick test with default200ms buffer: five restorations produced4/4/4/5/4 observed raw-output drops, max transient A/V11.8ms; interpolation resumes within the observation window. The first entry into bypass had7 cold-path drops. Full final soak remains in progress.
- Linux CI root cause was an unconditional Qt6.8-only QML property on Qt6.4.2. d41b9ac uses runtime availability check; actual Qt6.4.2 production QML parsed after failing before the change. Full Ubuntu rerun required.

## Final validation (2026-10-15)

- Production application source is148a0b5; PR head30d6226 adds only upstream release-note corrections. PR#8 merged asf472152. Ubuntu CI38719482586 passed53/53 against GitHub merge-ref738146d.
- Final148 Mac bundle reran19 deployed UI tests and actual intermediate-scroll checks. The47 unit results and native playback comparison are retained historical evidence from the preceding candidate; only guarded QML startup changed in final Mac production code.
- Final148 iPad package:2.7.0(270), unsigned public IPA, no profiles/keys/probes; signed development package restored and launched on M5 device without test arguments after all probes.
- With final playback code, speed/seek followed by a full-report-per-second soak produced161 render drops over639.7s, zero decoder drops/underruns, maximum A/V47.6ms. This run remains evidence of variable performance.
- A lower-overhead probe writes constant-size JSONL and serializes the final report after stopping playback. A separate normal-speed-only soak measured623.8s,14931 generated frames/29890 outputs,30 render drops(~0.10%),0 decoder drops,0 audio underrun warnings, max A/V46.0ms, memory1062.4–1100.7MB, thermal nominal/fair/serious, median inference24.8ms. Maximum sample acquisition82.3ms. Because the preceding workload also differs, this comparison does not establish telemetry as the cause of all earlier drops.
- Confirmed improvement is bounded fast-playback behavior and much smaller restoration transients. Sustained interpolation is not certified drop-free; Bluetooth/AirPlay, production-server playback and physical iPadOS26 remain outside this fixture validation.

- Follow-up read-only packet analysis: the840-second generated continuous fixture contains20122 video packets and38 existing83.333ms PTS gaps (normal interval41.667ms). The29 gaps before the final637.854s playback position exactly match the29 filter resets; these are correct discontinuity handling, not a second runtime drop counter. The30 VO drops are a separate344–346s burst with no coincident filter reset or VO reconfiguration. Logs show cadence estimation/float-upload texture rebuilds, but do not establish a unique cause of that burst.
