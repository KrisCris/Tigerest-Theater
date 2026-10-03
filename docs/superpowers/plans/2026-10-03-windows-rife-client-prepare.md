# Windows RIFE client playback, preparation and package size

> **For agentic workers:** Use superpowers:executing-plans for each owned task. Independent packaging investigation may run in parallel under superpowers:dispatching-parallel-agents. Do not run GPU tests concurrently.

**Goal:** Resolve the reported V2.3.2 fallback in the actual Emby client, hold first playback until engine preparation finishes with visible progress, and reduce downloads without removing supported NVIDIA architectures.

**Architecture:** Keep the existing player/controller/runtime boundaries. Diagnose the real media and UI before changing the performance guard. Make engine readiness part of the current item's startup gate, and expose preparation state to a themed waiting view. Provide architecture-specific sealed extension packages alongside a complete offline package.

**Tech Stack:** Qt 6.9.3, libmpv, VapourSynth/TensorRT, Python packaging, QtTest and actual Windows client acceptance.

**Spec:** User requests in this conversation on 2026-10-03: reproduce with the real client; align the startup bar; pause initial playback and show progress until preparation ends; shrink the 2 GB extension while retaining libraries for other GPUs.

## Global Constraints

- Preserve existing installation, settings, original extension and user documents.
- No threshold relaxation without identifying the real drop source.
- Waiting progress may be estimated, but must say so and never report completion before readiness.
- Cancel, stop, next item, user pause and preparation failure must terminate the wait correctly.
- All currently packaged GPU architectures remain available; unknown architectures use the full package.
- No credentials, server tokens, private media or user profile data in Git or release assets.
- RTX 4090 is the available hardware validation target, not the supported GPU list.

## Review Focus

- Actual network MP4, resume offset, subtitles and danmaku in the complete Emby flow.
- First engine build versus warm cached playback; asynchronous stale completion after stop/new item.
- Playback start, pause, seek and fullscreen while the initial hold is active.
- Windows scaling and startup-dialog alignment; readable stage and estimated progress.
- Architecture selection, package completeness and fallback for unknown/multiple GPUs.

## Task 1: Reproduce and repair actual client fallback

- [x] Capture current client diagnostics and reproduce the reported episode with the complete UI and plugins.
- [x] Compare the failing path with a controlled run; identify the originating drop source.
- [x] Add and observe a failing regression for the identified defect, then implement the focused repair.
- [x] Validate actual network playback, resume, fullscreen, subtitle/danmaku and pause/seek.

## Task 2: Wait for first engine preparation

Files: `src/player/PlayerComponent.cpp`, interpolation coordinator/runtime, `src/main.cpp`, UI resources and their behavioral tests.

- [x] Add failing coordinator/player tests for holding playback until a prepared engine is attached to the same item.
- [x] Implement generation-scoped completion/cancel/failure and preserve user pause intent.
- [x] Add themed, aligned startup/preparation progress with honest stage text and elapsed time.
- [x] Test cold preparation, warm start, pause, stop/reopen, seek and next item in the full client; cover failure and stale completion through native/Web regressions.

## Task 3: Smaller architecture packages

Files: `dev/windows/rife/prepare_runtime.py`, package builders, catalog/extension selection and associated tests.

- [x] Verify upstream TensorRT architecture resource requirements and measure current payload sizes.
- [x] Add failing tests for architecture package selection and unknown-GPU full fallback.
- [x] Build sealed per-architecture packages without dropping the full offline package or compatibility scope.
- [x] Validate full integrity, clean engine compilation and actual playback on available hardware; record other architectures as package-tested only.

## Integration and release

- [x] Run relevant tests, full suite, package checks and a fresh review.
- [x] Update README with waiting behavior, real validation boundaries and smaller package choices.
- [ ] Publish a new version only after the actual-client failure is reproduced and fixed; preserve V2.3.2 assets.
