# Server onboarding and danmaku routing implementation plan

> Execution: native implementation in the current task, as authorized by the user's request to change the app.

**Goal:** Let each user select the dedicated server or enter their own Emby, and select the owner's danmaku relay according to the initial Emby connection.

**Architecture:** The native startup page owns server choice and remembers the user's input. Qt checks the exact API address before following web redirects. The player publishes the relay endpoint to MPV; Lua remaps managed defaults and history while retaining deliberately customized providers.

**Tech stack:** Qt 6 / C++, JavaScript, MPV Lua, QtTest and Node test runner.

**Spec:** User requirements in this task: dedicated Emby at nas.tigerest.top:8095 or 192.168.5.150:8095; self-hosted addresses belong to individual users. Relay LAN is http://192.168.5.150:18443; all other connections use http://nas.tigerest.top:18443. Explain permissions on hover/focus and that self-hosted mode provides a player only.

## Constraints and review focus

- Never ship the friend's example address as a default; no fallback from a custom server to the dedicated server.
- Preserve externally supplied port, base path and IPv6 authority.
- Cancelled connection attempts must not navigate or change saved settings.
- Old danmaku history must follow LAN/domain switching; explicit third-party APIs remain usable.
- Report errors without claiming the friend's unreproduced network failure is fixed.

## Tasks

- [x] Add startup choices, hover/focus help, blank custom form, persisted connection mode and reset behavior in native/find-webclient.*, nativeshell.js and settings_description.json. Verify with tests/test_server_onboarding.js.
- [x] Update SystemComponent::extractBaseUrl and checkServerConnectivity, plus connectivityHelper.js: check the entered API first, return the matching web URL, expose HTTP/network errors. Verify with tests/test_systemcomponent.cpp including a TCP server with misleading root redirects.
- [x] Add MpvConfigManager::danmakuApiServer(serverUrl, mode), publish at playback load, and resolve managed Lua endpoints at every request/history restore. Verify C++ routing cases and tests/test_danmaku_metadata.cpp using the real MPV Lua runtime.
- [x] Build the Windows app, run the complete existing suite, inspect the rendered startup page with a temporary isolated profile, and test the real native bridge against a local HTTP fixture.
- [x] Review the diff and supply a usable local build with clearly stated external-server retest limitations.

## Verification evidence

- Windows native build succeeded; CTest: 17/17 passed, including real Qt/Chromium custom-server connection and persisted reconnection.
- Qt connectivity cases: 35 passed; misleading root redirects, API prefix redirects, IPv6, invalid inputs and HTTP error propagation covered.
- Real MPV Lua tests cover managed endpoint/history migration and preservation of source blocking/timing preferences.
- Independent review's two P2 findings were reproduced, fixed, covered by regressions and accepted on follow-up review.
- Native startup window visually inspected for both server explanations. Packaged executable also passed the native connection integration test without development DLL paths.
- LAN and domain relay health checks both returned HTTP 200 from this workstation. The friend's original routed network still requires an on-site retest.
- Portable test artifact: build/TigerestTheater-2.0.17-server-onboarding-test-x64.zip (separate from existing release artifacts).
