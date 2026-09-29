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
