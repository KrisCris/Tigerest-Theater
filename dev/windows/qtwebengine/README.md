# QtWebEngine 6.9.3 的 Windows 补丁

`patches.txt` 按应用顺序列出本目录的补丁。构建脚本依次应用，运行库清单记录每个补丁的文件名和 SHA256；配置和打包时必须与 `patches.txt` 完全一致。

| 补丁 | 作用 | 关闭对照 |
|---|---|---|
| `qtwebengine-6.9.3-d3d11-producer-sync.patch` | 共享纹理交给 Qt 前等待 Chromium 的 D3D11 写入完成，修复媒体库花屏 | `TIGEREST_D3D11_PRODUCER_WAIT=0` |
| `qtwebengine-6.9.3-begin-frame-vsync.patch` | 把窗口所在屏幕的刷新率交给网页合成器，解除 60 帧上限 | `TIGEREST_WEBENGINE_VSYNC=0` |
| `qtwebengine-6.9.3-wheel-step.patch` | Windows 鼠标滚轮每行 50 px（默认三行即每格 150 px） | `TIGEREST_WEBENGINE_WHEEL_STEP=<每行像素>` |

## 网页合成器刷新率

QtWebEngine 把网页画到离屏纹理再交给 Qt Quick 合成。这条路径下 Chromium 的显示合成器使用按固定间隔触发的 BeginFrame 计时器，间隔需要外部提供，而 Qt 从未提供，于是一直是默认的 1/60 秒：无论显示器多少 Hz，CSS 动画、Web Animations、`requestAnimationFrame` 和滚动都只有 60 帧。

补丁在 `RenderWidgetHostViewQt` 中每秒读取一次窗口所在屏幕的 vsync 参数，交给 `ui::Compositor::SetDisplayVSyncParameters`。Windows 使用 Chromium 自带的 `gl::VSyncProviderWin` 读取 DWM 的 vblank 时间和周期；若与窗口所在屏幕的 `QScreen::refreshRate` 相差超过 5%（多屏刷新率不同时），改用 `QScreen::refreshRate`。2026-10-14 在 4K 240 Hz / RTX 4090 上，同一 DLL 开关对照：rAF 从 60 到 240 帧，首页／媒体库／详情转场从 43–60 帧到 109–213 帧。

## 鼠标滚轮距离

客户端在 `webview.qml` 打开 `scrollAnimatorEnabled`（QtWebEngine 默认关闭，滚轮和 `scroll-behavior: smooth` 原本瞬间跳转）。QtWebEngine 把一格滚轮换算为“系统行数 × 20 px”，默认三行只有 60 px，加上滚动动画后显得很慢；Chrome 在 Windows 上为每格 100 px。补丁把 Windows 上每行改为 50 px，仍跟随系统“每次滚动行数”设置。用户试用 60／100／150 px 后选定 150 px。

## D3D11 同步

部分 Windows/NVIDIA 配置在媒体库悬停、滚动和显示设置面板时出现旧画面闪回和三角形缺块。独立 Qt Quick/WebEngine 静态页面也可复现，Qt 提交显示之前的抓帧已包含错误。补丁在 Chromium producer 的 D3D11 设备完成写入后，才把共享纹理交给 Qt 的另一个 D3D11 设备读取。

作用域是 `NativeSkiaOutputDeviceDirect3D11::Present` 的 GL/ANGLE producer 路径，不持有基类缓冲区锁等待。使用 EVENT query 的 `End/Flush/GetData`，确认 `S_OK`、完成标志和设备状态。250 ms 轮询截止后不发布该纹理，通过 `SWAP_FAILED` 走 Chromium 原有 context-loss 恢复。此截止不能中断卡在驱动 API 内的调用。

默认启用；设置 `TIGEREST_D3D11_PRODUCER_WAIT=0` 可做关闭对照。`TIGEREST_DIAG_PRODUCER_FAIL_ONCE=1` 仅用于测试：第八次提交模拟未完成，等待至截止并注入一次恢复。普通启动不设置这些变量。原先公共 `createFence()` 内的无限等待诊断不属于此补丁。

## 重建组件

上游来源：[Qt 6.9.3 源码存档](https://download.qt.io/archive/qt/6.9/6.9.3/submodules/qtwebengine-everywhere-src-6.9.3.tar.xz)。归档 SHA256：

```
d50b3b11d51dd876418cc36b4d6c96b4721e0aab773a3dd6beda606d46da8966
```

在已初始化的 VS 2022 x64 开发环境运行，需具备 x64/x86 编译工具、ATL 和 Windows SDK。实测工具为 MSVC 14.44.35207、SDK 10.0.26100.0、Python 3.12.10（含 html5lib）、Node 24、CMake/Ninja，以及 bison/flex/gperf/perl。参见 [Qt WebEngine 平台与构建说明](https://doc.qt.io/qt-6/qtwebengine-platform-notes.html)。使用较短的 ASCII 构建路径，源码、构建和安装目录分开。

```powershell
./dev/windows/qtwebengine/build.ps1 `
  -SourceDirectory C:/QtBuild/webengine-src `
  -BuildDirectory C:/QtBuild/webengine-build `
  -QtRoot C:/Qt/6.9.3/msvc2022_64 `
  -InstallDirectory C:/QtBuild/webengine-runtime `
  -PythonExecutable C:/QtBuild/tools/Scripts/python.exe -Jobs 8
```

脚本按 `patches.txt` 顺序应用本目录补丁，编译 Release 组件，安装到独立目录，并记录各补丁和 DLL 的 SHA256。首次完整编译 Chromium 耗时较长。

## 客户端开发与打包

开发启动前设置 `TIGEREST_WEBENGINE_RUNTIME` 为上述组件安装目录，再运行 `dev/windows/run.bat`。Qt 基础组件仍使用同版本的 MSVC 版 Qt 6.9.3。

已有 CMake 构建目录需明确更新缓存：

```powershell
cmake -S . -B build -DTIGEREST_WEBENGINE_RUNTIME=C:/QtBuild/webengine-runtime
cmake --build build
```

Windows 打包在 `windeployqt` 完成后覆盖 WebEngine DLL、辅助进程、资源和 QML 模块，防止打包时恢复为上游 DLL。补丁和本文随包保存于 `licenses/qtwebengine-tigerest`。无需把 Qt 完整源码或编译中间文件放入客户端安装目录。

修复运行库是 Windows 构建和打包的必需依赖。`build.bat` 自动查找依赖目录下的 `qtwebengine-sync/6.9.3`，也可显式设置 `TIGEREST_WEBENGINE_RUNTIME`。配置和安装阶段均校验版本、完整文件、源码补丁及核心 DLL 的 SHA256；路径为空或验证失败时停止，不能退回原版 QtWebEngine。安装后再次校验实际部署的核心 DLL，避免旧缓存或文件时间戳使修复失效。

## 回归证据

2026-09-13，Windows 11 23H2 / RTX 4090 / 驱动 616.64：相同 DLL 关闭等待可重复捕获缺块，开启有界等待后十轮、每轮约十二秒的鼠标悬停测试未捕获加载完成后的固定内容区异常。模拟超时触发恢复后继续产生有效画面并响应鼠标。此前无限等待诊断的开关对照及用户手动反馈也支持此同步措施有效。

最终客户端已通过全部 14 项 CTest；实际验证媒体库先全屏再播放时，uosc 正确显示退出全屏，鼠标单击即可窗口化，mpv 与宿主窗口状态均为 false。模拟超时恢复后的独立测试程序正常退出，退出码为 0。安装目录中的客户端使用原有配置启动，确认加载补丁 DLL、D3D11 硬件合成和光栅化均启用，默认同步日志正常。

手动覆盖旧安装时，还需把本次构建的 `redist/*.dll` 更新到程序目录，避免残留的旧版应用私有 VC++ 运行库优先于系统新版加载。此次旧版 14.29 的 `MSVCP140.dll` 导致启动访问冲突，替换为随包的 14.44 后正常。便携包准备脚本已包含将这些 DLL 放入根目录的步骤。

这些结果覆盖该受影响配置，不代表已验证所有 GPU、驱动或完整缓冲区复用协议。固定区域哈希与抽样画面检查也不能覆盖所有帧和全部像素。
