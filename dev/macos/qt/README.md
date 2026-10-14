# Mac display-link experiment (Qt 6.9.3)

Status: built and measured in an isolated arm64 preview. It is **not enabled in release builds**. Native playback results, the final review, and remaining preview limitations are recorded in `docs/reports/2026-10-14-mac-120hz.md`.

The stock Qt WebEngine compositor receives `display_id = -1` on macOS. Chromium's `ExternalBeginFrameSourceMac` then uses a 16.666 ms timer instead of a display link. On the test Mac, QScreen and CoreVideo both report 120 Hz, headed Chrome delivers ~120 rAF callbacks/s, and stock Qt delivers ~60 callbacks/s and ~60 Qt window submissions/s. Merely switching Qt Quick to Metal does not change this.

`macos-display-link.patch` supplies a CoreGraphics display ID whenever the WebEngine view updates its screen information, including an explicit screen-change notification. It uses the screen containing the QScreen geometry center, not Qt's indexed display ID. A failed mapping discards the stale display ID and allows Chromium's normal fallback. Chromium owns the display link; no fixed 120 Hz timer or unlimited-frame flag is used.

Source archive: [QtWebEngine 6.9.3](https://download.qt.io/archive/qt/6.9/6.9.3/submodules/qtwebengine-everywhere-src-6.9.3.tar.xz)

SHA256: `d50b3b11d51dd876418cc36b4d6c96b4721e0aab773a3dd6beda606d46da8966`

Apply all four patches in this directory to the extracted source with `patch -p1`. Besides the display-link change, they restore an SDK declaration, select the actual architecture's linker response file for a single-architecture Mac build, and make out-of-tree generated extension headers discoverable with valid include guards. These compatibility changes retain the existing enabled features.

Build outside the repository and installed application. Use the existing Qt 6.9.3 SDK's `qt-cmake` and `libexec/gn` (version `6.9.3.qtwebengine.qt.io`), Xcode 27, an isolated Python 3.9 environment with html5lib 1.1, and these CMake settings:

```text
CMAKE_BUILD_TYPE=Release
CMAKE_OSX_ARCHITECTURES=arm64
CMAKE_OSX_DEPLOYMENT_TARGET=12.0
CMAKE_INSTALL_PREFIX=<isolated-install>
Python3_EXECUTABLE=<isolated-python>
Gn_EXECUTABLE=<qt-sdk>/libexec/gn
FEATURE_webengine_build_gn=OFF
QT_FEATURE_qtpdf_build=OFF
QT_BUILD_TESTS=OFF
QT_BUILD_EXAMPLES=OFF
QT_SHOW_EXTRA_IDE_SOURCES=OFF
```

Ensure `xcrun metal --version` succeeds with the selected Xcode. If Xcode reports a missing Metal Toolchain, install its matching component with `xcodebuild -downloadComponent MetalToolchain`.

The **dependency** deployment target matches the official Qt 6.9.3 framework's `LC_BUILD_VERSION` (12.0). Building that old engine with a 26.0 minimum causes Xcode 27 to reject legacy WebRTC capture interfaces that were obsoleted in 15.0. The Tigerest application itself retains its 26.0 minimum; this does not add support for older macOS versions.

Place `<qt-sdk>/libexec` on PATH during the build as well: the GN generation subprocess locates GN independently of the configure cache. The first probe only needs `WebEngineCore`, `WebEngineQuick`, `QtWebEngineProcess`; build the complete module before installing, so the WebEngine QML plugin and delegates match too. The standalone QtPdf module is omitted; WebEngine's printing/PDF support remains enabled.

For an isolated install (paths are examples to replace with your own):

```sh
export DEVELOPER_DIR='/path/to/Xcode-beta.app/Contents/Developer'
export PATH='/path/to/qt/6.9.3/macos/libexec':"$PATH"
cmake --build /path/to/qtwebengine-build -j 8
# Qt's installer expects GN here even when using the matching prebuilt tool.
mkdir -p /path/to/qtwebengine-build/install/bin
cp /path/to/qt/6.9.3/macos/libexec/gn /path/to/qtwebengine-build/install/bin/gn
cmake --install /path/to/qtwebengine-build --prefix /path/to/isolated-webengine
```

Use a separate copy of the matching full Qt SDK when integrating this module into a normal application build. Overlay this install there and point the app's `QTROOT` and `CMAKE_PREFIX_PATH` to that copy, so `macdeployqt` packages the candidate instead of silently copying stock WebEngine. Do not overwrite the original SDK or installed application. Verify the bundled helper, resources, locales and QML/delegate components as well as the main framework.

Before enabling the patch in packaging, verify the actual display ID in Chromium logging, rAF cadence, Qt window submissions, 60 Hz fallback, monitor migration, idle/minimized behavior and native player integration. Window submissions and rAF are not proof of physical screen presentation.

Build the small `probe/` CMake project with the same Qt SDK, then run:

```sh
node tests/bench_frame_source.cjs /absolute/path/TigerestFrameProbe.app/Contents/MacOS/TigerestFrameProbe \
  --backend=metal --hz=120 --assert-target --output=/absolute/path/frame-source.json
```

Run without concurrent builds and with the probe foreground on the intended display. The stock engine fails this check (~60 rAF/s, ~60 window submissions/s); test both `metal` and `opengl` against the candidate framework. The probe uses an off-the-record web profile and only loopback fixture content.

UI benchmark (isolated synthetic library; no server credentials):

```sh
node tests/bench_home_motion.cjs '<client-or-Chrome>' --webengine \
  --rounds=3 --dpr=2 --hz=120 --output=/absolute/path/report.json
```

Omit `--webengine` for Chrome. The benchmark uses visible GPU rendering, matching 1280×720/DPR2 geometry, and the production transition/appearance code. Default scrolling is driven by the page at 1000 CSS pixels/s; it is not a physical trackpad-input test. `--scroll=native` adds a CDP wheel-gesture check in Chrome; Qt does not complete that CDP operation. Never compare benchmark runs while compiling the dependency.

Xcode 27 also drops the `kSBXProfilePureComputation` declaration from `sandbox.h` while still exporting the exact symbol from libSystem. Apply `xcode27-sandbox-declaration.patch` when using this SDK. It restores only the declaration, preserving the existing profile and sandbox behavior. A linked/run symbol probe on the test Mac returns `pure-computation`.

The frame probe supports `--lifecycle` to check settled idle, minimized, hidden and restored Qt submissions. On this launch setup both Qt and direct AppKit requests fail to actually miniaturize the native window, so the strict combined test correctly fails that exercise precondition. This is not evidence of background rendering in a successfully minimized client. Actual hiding and idle both produce zero window submissions; restoring returns to high refresh. Minimization still needs independent validation. `PROBE_NATIVE_ANIMATION=1` adds a small Qt Quick rotation to distinguish the native scene's clock from WebEngine's. Do not use this extra animation for the idle check.

When testing a temporary 60 Hz mode with `CGDisplaySetDisplayMode`, keep the requesting process alive, verify the **current** mode while it is alive, and restore/verify the original mode in `finally`. macOS restores an app-requested mode when that app exits; launching a short-lived setter and then running the benchmark measures the original mode by mistake. With the setter held alive, the candidate follows 60 Hz (~59.995 rAF/s and ~60 Qt submissions/s).

Use `--viewport=fullscreen` for an additional measurement at the real client viewport without CDP size emulation. The collector pre-rolls rAF before invoking the action so its first delay is retained, and reports startup latency separately. Do not discard preparation hitches when reporting aggregate performance. The standalone full-screen preview scrolls at 120 rAF/s; transition averages remain ~109–118, with occasional route-preparation hitches and larger first-run stalls. These are scheduling measurements, not physical presentation.

For local delivery, keep `launch-preview.command` beside `Applications/Tigerest Theater.app`. It uses a separate configuration root and a uniquely named profile (also separating local IPC sockets). Run it to open the preview; do not directly launch the inner app against the installed player's default profile. The preview requires its own login. It does not replace the installed application.
