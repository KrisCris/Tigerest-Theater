# VapourSynth plugin headers

`VapourSynth4.h` is unmodified from VapourSynth commit
`f9d3e4a24b909b7f826dbdb520b3c5078462b311`, the header revision recorded by
the frozen mpv build source lock.

- Source: https://github.com/vapoursynth/vapoursynth/blob/f9d3e4a24b909b7f826dbdb520b3c5078462b311/include/VapourSynth4.h
- SHA-256: `e454cce5d2e8c7c5d70493fa4a2ddb39e3b5332034adb706b871af62980ccc45`
- License: LGPL 2.1 or later, as retained in the file header. The private VS
  runtime also retains its upstream license texts.

Windows builds only a lightweight Monitor plugin against this header.
VapourSynth, Python and TensorRT binaries remain in the optional extension.

`VSScript4.h` is unmodified from VapourSynth R79 commit
`acabf605b2205b32d65859bb2736405719d2fafd` and is used by the fresh native-host
embedding regression test.

- Source: https://github.com/vapoursynth/vapoursynth/blob/acabf605b2205b32d65859bb2736405719d2fafd/include/VSScript4.h
- SHA-256: `357b4aca7003d71d3ec381c44424c8b649bcd116ea7880c4afb0c872cd569942`
- License: LGPL 2.1 or later, retained verbatim in the header.
