# RIFE model tools (macOS development only)

These tools prepare and measure a model; they are not application runtime
dependencies. Use an isolated Python 3.13 environment on Apple Silicon:

```sh
python3.13 -m venv build/rife/venv
build/rife/venv/bin/pip install -r dev/macos/rife/requirements-build.txt
build/rife/venv/bin/python dev/macos/rife/prepare_model.py build/rife/source
RIFE_TEST_MODEL=build/rife/source build/rife/venv/bin/python -m unittest discover -s tests -p 'test_rife_*.py'
```

Source, archive and weight digests are pinned in `model_source.json`. Never
replace these files with unverified training code or checkpoints. No model is
downloaded by the player. Large outputs belong under ignored `build/rife/`.

The first candidate for playback is FP32 with `--grid-scale 0.5`. Motion is
estimated at half resolution, then flow and mask are enlarged to warp the
original RGB frames. This differs from upstream `--scale 0.5`, which only
changes internal block sizes. Reduced grids can lose motion detail and require
visual qualification independently of numerical conversion parity. The two
scale reductions cannot be combined.

```sh
build/rife/venv/bin/python dev/macos/rife/convert_model.py \
  --source build/rife/source --output build/rife/models/1080-grid-half-fp32 \
  --width 1920 --height 1080 --grid-scale 0.5
clang++ -std=c++17 -O3 -fobjc-arc -mmacosx-version-min=26.0 \
  -framework Foundation -framework CoreML dev/macos/rife/benchmark.mm \
  -o build/rife/rife-benchmark
build/rife/venv/bin/python dev/macos/rife/benchmark.py \
  --source build/rife/source --model-dir build/rife/models/1080-grid-half-fp32 \
  --binary build/rife/rife-benchmark --compute cpu-gpu \
  --output build/rife/results/1080-grid-half-fp32-cpu-gpu.json
```

Repeat with `all` and `cpu-ane` to compare public compute configurations.
The harness uses actual native synchronous Core ML inference, 30 warmup calls
and 120 measured calls. It repeats one input pair and excludes decoding and
color conversion; a passing result permits further integration work, not a
real-time playback claim. Full-player qualification remains required.
Short probes are useful diagnostics but cannot pass the gate.

Other `--precision` values are diagnostic candidates. `fp16` and mixed
precision can substantially change motion; each conversion must pass reference
tests before it can be considered. `RIFE_TEST_PRECISION` selects a diagnostic
candidate for the small parity test. A name or successful conversion never
implies the model is qualified.

MLComputePlan reports planned operator placement, not runtime ANE usage.
The harness deliberately reports `runtime_ane_evidence: false`. Establish
actual execution separately using Instruments with the corresponding model
and configuration. A CPU+ANE selection may fall back to CPU. Never use private
ANE APIs or infer energy savings from a configuration name.

Generated manifests record dimensions, both scale values, precision, source
revision, weight digest and conversion library versions. Benchmark fixtures
are invalidated when that manifest changes. Keep device-specific JSON, raw
outputs and profiling traces outside the user README.

The explicit split candidate moves the feature encoder and final refinement
convolutions to two contiguous FP16 models. Coarse motion estimation and final
warping remain FP32 on GPU. This reduces automatic device switching inside a
single graph; it still incurs transfers between the four stages.

```sh
build/rife/venv/bin/python dev/macos/rife/split_model.py \
  --source build/rife/source --output build/rife/models/1080-split-refine \
  --width 1920 --height 1080 --grid-scale 0.5 --offload-refine
RIFE_TEST_MODEL=build/rife/source build/rife/venv/bin/python tests/test_rife_split_conversion.py
xcrun clang++ -std=c++17 -O3 -fobjc-arc -mmacosx-version-min=26.0 \
  -framework Foundation -framework CoreML dev/macos/rife/benchmark_split.mm \
  -o build/rife/rife-split-benchmark
build/rife/venv/bin/python dev/macos/rife/benchmark_split.py \
  --source build/rife/source --model-dir build/rife/models/1080-split-refine \
  --binary build/rife/rife-split-benchmark --compute cpu-ane \
  --output build/rife/results/1080-split-refine-ane.json
```

Use the installed Xcode matching the OS through a per-command `DEVELOPER_DIR`;
the tools do not change the system-wide selection. Repeat with `cpu-gpu` for
the same split graph on GPU. The prototype benchmark includes low-grid
preparation and output copies, but excludes full-frame input copies. Use
`test_rife_split_engine <model-directory> --benchmark` for native engine timing
including those copies and input validation.

The engine retains only the preceding pair's second frame and encoded features.
Reuse requires matching immutable frame index and generation; a seek, format
change, nonadjacent request, missing identity, explicit reset or inference
error invalidates that reuse. Callers must never recycle an identity for
changed pixels. The original monolithic GPU pipeline remains available.

`SplitEncoderRefineMetal` replaces the final Core ML Warp model with one Metal
kernel: it enlarges flow and mask, warps the padded original frames, and blends
them without materializing intermediate full-size images. Full-frame inputs
share Metal storage with the engine. Public Core ML `outputBackings` propose
shared flow/delta/mask buffers; the engine checks object identity and copies
when a backend declines them. Tests cover fractional coordinates, padded
borders, odd image sizes, non-contiguous tensors and full-network parity.

Build the complete-call benchmark against the CMake-built native library:

```sh
xcrun clang++ -std=c++17 -O3 -fobjc-arc -mmacosx-version-min=26.0 \
  -I src/player/interpolation -L "$RIFE_BUILD_DIR/src/player/interpolation" \
  -Wl,-rpath,"$RIFE_BUILD_DIR/src/player/interpolation" -ltigerest-rife \
  -framework Foundation dev/macos/rife/benchmark_engine.mm \
  -o build/rife/rife-engine-benchmark
build/rife/rife-engine-benchmark \
  --model-dir build/rife/models/1080-split-refine --pipeline split-metal \
  --compute cpu-ane --warmup 30 --iterations 600 --interval-ms 33.333333 \
  --output build/rife/results/engine-split-metal-ane.json
```

Set `RIFE_BUILD_DIR` to the configured CMake build directory. An interval of
zero runs at maximum throughput. Nonzero intervals use absolute deadlines,
with actual prediction rate and deadline misses recorded separately from
per-call latency. The raw output still needs reference validation; a successful
benchmark process alone does not establish the quality or playback gate.

`benchmark_render_load.py` measures contention against a separately launched
mpv instance using an explicitly supplied private IPC socket. Load the actual
project profile, verify `vo-passes`, then compare both device policies and the
monolithic candidate in forward/reverse order. The report records render
passes and delayed/dropped-frame counters as well as inference latency. It
is a concurrent load test, not integrated playback or A/V qualification.
Sampled render-pass times are not GPU utilization, and clock scaling can make
passes faster under higher load. Do not infer power savings from them.
Use `--engine --metal --interval-ms 33.333333` for complete-call comparisons.
Record the actual output dimensions and active passes: shader conditions differ
between downscaling and upscaling. The renderer's delayed-frame counter is an
estimate, and its zero dropped-frame count is not an A/V playback qualification.
