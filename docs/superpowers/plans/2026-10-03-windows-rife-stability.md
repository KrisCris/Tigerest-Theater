# Windows RIFE stability repair

> **For agentic workers:** Use superpowers:executing-plans to implement and verify each task inline, with a fresh review of the finished change.

**Goal:** Keep capable Windows systems interpolating during ordinary playback and remove repeated multi-gigabyte startup hashing.

**Architecture:** Diagnose the actual Qt Player with real 23.976 fps animation before changing fallback policy. Cache successfully verified extension files using protected receipts, the same open Windows file handle, 128-bit identities, sizes, USNs and journal generations. Exclude active writers while verifying; retain full hashing when reliable NTFS change information is unavailable. Still enumerate the complete tree and authenticate the manifest on every launch. A runtime already verified by the extension manager may use the isolated native probe directly, while standalone runtimes retain full verification.

**Tech stack:** Qt 6, libmpv, VapourSynth R79, TensorRT, Win32 file metadata and DPAPI.

**Spec:** User report on 2026-10-03: all Windows RIFE presets fall back despite available performance, and each launch waits a long time at extension verification.

## Constraints and review focus

- Preserve current user settings, programs, extension files, and engine caches.
- Do not turn off protection against corrupt/missing/unlisted files or actual sustained playback overload.
- Validate 23.976 fps, pause/seek, audio sync, scene cuts and renderer load, not only synthetic 30 fps clips.
- A same-size replacement with restored modification time must invalidate cached verification.
- An unreadable, malformed or modified receipt must fall back to full verification.
- No webpage-supplied paths or trust flag; the native extension-manager success path owns trust.
- Keep Mac behavior unchanged unless an independently demonstrated shared bug requires repair.

## Tasks

- [x] Reproduce with real animation; compare source formats and collect timing/drop counters before fallback.
- [x] Add failing regression tests for the demonstrated playback cause; implement the smallest correction and prove overload still recovers.
- [x] Add failing warm-start and corruption tests, implement protected per-file verification receipts, and avoid the second full verification after the manager has verified the extension.
- [x] Validate full extension cold/warm checks and sustained real Player playback for all three models, including seek/pause and actual audio/rendering.
- [x] Run the complete suite, request independent review, update README/CHANGELOG and prepare the verified patch release.

Publication follows these completed implementation checks. Successful same-commit CI builds, artifact hashes and final publication are recorded in the versioned release manifest; do not change the frozen source commit to insert changing CI run statuses.

## Evidence ledger

- Baseline synthetic 24 fps: 25 seconds measured, 24→48 fps, no new VO drops, maximum A/V difference 12.9 ms.
- Baseline real 1080p 23.976 fps animation: nominal 60 target selects factor 3 (71.928 fps); at 15 seconds, 854 VO drops and 1.209 seconds A/V difference, then performance fallback.
- Startup source performs full extension hashing followed by public runtime probe hashing the same payload again.
- Corrected real-source playback: lite, standard and heavy each completed 180 measured seconds with pause/seek, no fallback and zero additional VO/decoder drops; 18 scene-cut bypasses in each run.
- Complete client startup using the original full extension: cold 18.406 seconds, warm 2.789 seconds; warm launch reused 114 verified files and activated the isolated NVIDIA runtime.
- Review exposed mapped-write timestamp and USN coalescing cases; RED/GREEN regressions now cover both closed mappings and repeated writes while the view remains open. Verification excludes write/delete sharing.
- Review exposed refresh-window attribution across display changes; RED/GREEN tests cover both directions and subsequent genuine overload.
- Final suite: 58/58 in 86.25 seconds; final source build, package generation and full portable controls passed. Full portable client retained interpolation for 45 seconds with pause/seek and an existing engine cache hit.
- Independent reviewer retested timestamp-restored corruption, closed mapped writes, active mapped writers, modified receipts and warm reuse; no outstanding findings.
