# RIFE development tools

These tools build and verify the bundled model; they are not required on users’ machines.

Use the pinned `requirements-build.txt` in an isolated Python environment. `prepare_model.py` verifies the source and weights against `model_source.json`; `convert_model.py` and `split_model.py` write model manifests and reference fixtures. Generated environments, models and benchmark reports belong in ignored `build/rife/`.

The selected experimental pipeline is `split-metal` with `cpu-ane`: Encoder and Refine use Core ML’s CPU/Neural Engine configuration, Coarse uses CPU/GPU, and final warping uses Metal. Actual device execution and full playback performance require separate qualification; configuration names do not prove Neural Engine execution. The monolithic GPU path remains available for comparison.

## Streaming integration

The native plugin requires VapourSynth 79 headers. The included script preserves original YUV samples, validates SDR metadata before conversion, and performs only 2× interpolation at up to 30 input fps. Unknown color, HDR, interlacing and detected VFR bypass inference.

mpv must include the VapourSynth 74+ API compatibility change and `mpv-eof-aware.patch`. The new `vapoursynth:eof-aware=yes` option gives the adapter one-frame lookahead, a reliable last-frame marker, standard color properties and a nominal final-frame duration when the decoder omits it. Existing VapourSynth filters keep their default behavior. The RIFE controller must use a bounded buffer and concurrent-frames=1.

Configure these CMake cache variables to run the actual-model streaming tests:

- `RIFE_TEST_MODEL_ROOT`: prepared model root, including `128-fp32`, `1080-split-refine` and `1080-grid-half-fp32`.
- `RIFE_TEST_VS_PYTHON`: Python interpreter containing VapourSynth 79.
- `RIFE_TEST_MPV`: test mpv with the EOF patch.
- `RIFE_TEST_VSSCRIPT_LIB`: matching `libvsscript.dylib`.

Build `tigerest_rife_vs` and the native `test_rife_*` targets, then run `ctest -R '^test_rife_' --output-on-failure` in the build directory. The tests use temporary clips and private IPC sockets; they must not connect to an installed player’s SVP endpoint.

The model inference code runs natively. The embedded Python bridge only coordinates VapourSynth nodes and metadata. Full installation closure, application control and performance qualification are separate from plugin correctness.
