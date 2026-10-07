# RIFE Half-Step Multipliers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support 1.5×, 2.5×, 3.5× and subsequent half-step Windows RIFE multipliers in the existing target-frame-rate control.

**Architecture:** Quantize the requested/source FPS ratio to the nearest half step (ties lower), retaining NTSC nominal-rate selection. Represent graph sampling exactly as numerator/denominator; generate intermediate frames at the actual target timepoints and preserve total source duration, including a shortened final output frame. The monitor accepts integer numerator plus optional denominator while existing integer callers remain valid.

**Tech Stack:** C++/Qt, libmpv, VapourSynth, Python, TensorRT.

**Spec:** User request of 2026-10-07: “补帧帧率允许.5倍（即1.5、2.5、3.5x等）”. Existing target FPS input remains 24–360; 0 retains legacy 2×. Mac's existing fixed 2× backend and Android playback remain unchanged.

## Global Constraints
- Preserve installed player/profile; verify with isolated test profiles.
- Before CTest/native executables, read dev/windows/TESTING.md and dot-source Enter-TestEnvironment.ps1 in the same invocation.
- Deliver trial instances first; do not publish.
- Accept only finite multiples of 0.5 from 1.5 through 15.

## Review Focus
- NTSC source rates: 24000/1001 targeting 60 selects 2.5× and outputs 60000/1001.
- Odd-length and one-frame sources retain exact duration without looking beyond EOF.
- Cut/unsupported-metadata bypass still preserves timing and avoids inference.
- Session resets and half-step metrics do not accumulate stale counts.
- Integer multipliers retain existing behavior and plugin callers remain compatible.

### Task 1: Native policy and monitor
**Files:** InterpolationPolicy.*, FrameInterpolationController.*, windows/RifeRuntimeManager.cpp, RifeSessionMetrics.*, RifeVsMonitor.cpp and corresponding native tests.
**Interfaces:** `double interpolationMultiplier(Rational,int)`; RuntimePaths.factor and guard/metrics factor become double. Monitor signature gains `factor_den:int:opt` default 1; factor is the numerator.
- [x] Add and observe failing policy/runtime/metrics tests for half steps, invalid values, NTSC and resets.
- [x] Implement policy, JSON forwarding, validation and rational monitor counting.
- [x] Rebuild and run native focused tests.

### Task 2: Rational frame graph
**Files:** resources/mpv/rife/trt_pipeline.py, tests/test_rife_trt_pipeline.py.
**Interfaces:** Options.factor accepts validated int/float half steps. Output n maps to source floor(n*den/num), timestep (n*den mod num)/num. Monitor receives factor=num, factor_den=den.
- [x] Add and observe failing finite graph tests covering 1.5, 2.5, 3.5 and integer regression.
- [x] Implement rational lazy sampling and exact final-frame duration.
- [x] Verify real VapourSynth graph tests, including bypass and EOF behavior.

### Task 3: Streaming integration and delivery
**Files:** tests/test_rife_windows_stream.py, settings_description.json, dev/windows/rife/README.md, revision report.
- [x] Extend native libmpv + tiny TensorRT stream cases for fractional factors, asserting indices, synthesis timepoints, exact durations and metrics.
- [ ] Verify full native suite and actual renderer/playback integration; correct issues revealed by streaming.
- [ ] Update help, build trial artifacts with patched QtWebEngine, launch isolated Windows trial and preserve Android trial. Record actual checks and limitations; no release.
