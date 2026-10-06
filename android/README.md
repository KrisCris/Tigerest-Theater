# 大河影院 Android 客户端

独立 Kotlin 工程，最低 Android 15（API 35），目标 API 36，内置 arm64-v8a / x86_64 的 libmpv，无需另装播放器。现有 `native/` 网页插件、消息中心、评论与深色金色样式在构建时同步到 APK；安卓通过限定来源的 WebMessage 桥接替换 Qt WebChannel。

## 使用

安装 `dist/TigerestTheater-2.4.1-android.2.apk`，打开“大河影院”，选择服务器或输入自己的 Emby 地址，然后在服务器网页登录。登录信息保留在安卓应用私有 WebView 中。普通 Emby 地址可以播放媒体；消息与评论沿用原客户端的服务路由与授权规则，需要相应的服务支持。

视频播放自动进入沉浸界面，返回网页时恢复系统栏，安卓不显示桌面全屏／窗口按钮。轻触空白处显示／隐藏控制栏，播放时约 3.5 秒自动收起；拖动进度或打开菜单时保持显示。常用暂停、前后跳转、弹幕和倍速直接显示，音轨、内嵌及 Emby 外置字幕、字幕偏移、画质、前后集和客户端设置在“更多”中。音频保留网页播放器界面。应用进入后台时暂停；当前版本未实现后台持续播放或画中画。

弹幕支持按作品／季／集自动匹配，手动作品搜索、集数选择、视频网站来源、XML / JSON / ASS 文件导入、源屏蔽、时间偏移和样式。源策略按作品季及稳定提供方保存，弹幕内容按集缓存。自动匹配遇到不明确的续季或特别篇会提示手动选择。`客户端设置 → 弹幕 → apiServer` 可填兼容 Dandanplay API 的服务地址；默认使用现有大河弹幕服务。

布局依据当前窗口及密度，支持横竖屏、内外屏切换、自由窗口和分屏尺寸。遇到系统上报的分隔折痕时使用可用的一侧。背景和视频覆盖到挖孔区域，仅交互控件避开挖孔及系统栏；键盘缩小网页区域，自由窗口标题栏单独处理。屏幕变化不会主动重载网页或媒体；视频表面改变尺寸时重新配置 EGL 输出，保留播放时间和暂停状态。

## Windows 构建

需要 Git、Python 3、PowerShell。首次准备依赖与构建：

```powershell
./android/build.ps1 -Bootstrap
```

脚本使用 `toolchain.lock.json` 中固定 URL 和 SHA-256 下载 JDK 21、Gradle 8.13、SDK 命令行工具及官方 mpv-android APK，依赖缓存默认在 `D:\CodexDeps\TigerestTheater\android`。可用 `-DependencyDirectory` 改变位置。SDK 安装使用 Android 的标准许可接受流程；首次下载需要网络。

Windows 上 Gradle/JUnit 对中文路径的类发现有问题，脚本创建 ASCII 目录联接，默认 `C:\A\tigerest-android`。如果它已指向别的仓库，指定另一个 `-AsciiWorkspace`；脚本不会替换现有目录。Android Studio 可在依赖准备完成后打开这个联接下的 `android` 工程。

```powershell
./android/build.ps1 -Tasks testDebugUnitTest,lintDebug,assembleDebug,assembleDebugAndroidTest,assembleRelease
./android/tools/sign_release.ps1
```

签名脚本首次生成本地发布密钥，保存到依赖缓存的 `signing` 目录并限制 ACL。请备份该目录中的密钥和配对密码文件；后续更新必须沿用此密钥。密钥、密码、JNI 二进制、构建输出和临时测试资料均不进入 Git。可用 `-SigningDirectory` 指定自己的密钥目录；上架时应使用项目的正式签名流程。

`verify_apk.py` 检查实际 APK 中所有 20 个原生库：与锁文件的 SHA-256 完全相同、ELF PT_LOAD 至少 16 KB 对齐、ZIP 不压缩且数据偏移按 16 KB 对齐。此检查不能替代 16 KB 设备的实际运行测试。

## 测试

调试版包名是 `top.tigerest.theater.debug`，与正式版 `top.tigerest.theater` 分开保存数据。设备测试使用本机 HTTP 夹具、`adb reverse` 与调试 WebView 的 CDP；不会向生产评论／消息接口写入。Node.js 24+ 可运行以下脚本；通过环境变量 `ADB`、`ANDROID_SERIAL` 指定设备。

```powershell
adb install --no-incremental -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r -t android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell am force-stop top.tigerest.theater.debug
adb shell am instrument -w top.tigerest.theater.debug.test/androidx.test.runner.AndroidJUnitRunner
node --test android/tests/test_android_bridge.cjs tests/test_nativeshell_window_button.cjs
$env:TIGEREST_ANDROID_FIXTURE='1'
node tests/test_community_messages_ui.cjs android --webengine
node android/tests/test_comments.cjs
node android/tests/test_settings.cjs
node android/tests/test_shared_players.cjs
node android/tests/test_danmaku.cjs
node android/tests/test_windows.cjs
node android/tests/test_freeform.cjs
node android/tests/test_keyboard.cjs
node android/tests/test_navigation.cjs
node android/tests/test_player_layout.cjs
```

媒体测试需要 `android/test-artifacts/playback-fixture.mp4`。用 FFmpeg 生成 90 秒 H.264 720p、两个 AAC 音轨的测试文件：

```powershell
ffmpeg -f lavfi -i testsrc2=size=1280x720:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -f lavfi -i sine=frequency=660:sample_rate=48000 -t 90 -map 0:v -map 1:a -map 2:a -c:v libx264 -preset ultrafast -crf 28 -c:a aac -metadata:s:a:0 language=eng -metadata:s:a:1 language=jpn -movflags +faststart android/test-artifacts/playback-fixture.mp4
```

`test_windows.cjs` 与 `test_player_layout.cjs` 专门针对此次连接的折叠机：内屏 2224×2488、外屏 1080×2520，设备状态 3/0。它们保存并恢复旋转等覆盖，结束后重置为物理设备状态；不同机型应先调整状态／分辨率断言。播放器布局测试覆盖两面板的横竖屏、触控边界、长按拖动、菜单与自动隐藏；应同时目视检查截图，几何断言无法识别视频纹理重复。字幕 UI 测试触控位置也基于这台机的内屏。通用功能代码不依赖这些测试尺寸。

完整覆盖、未测边界与审查修复见 `../docs/reports/2026-10-06-android-client.md`。

## 原生来源与许可

内置未修改的 [mpv-android 2026-09-17 官方发布](https://github.com/mpv-android/mpv-android/releases/tag/2026-09-17) 中的原生库和对应 MIT JNI 绑定。运行时报告 `mpv v0.41.0-1049-g0b7ed670f`。源代码与原生构建方法在[该版本 buildscripts](https://github.com/mpv-android/mpv-android/tree/2026-09-17/buildscripts)，mpv 对应[提交 0b7ed670f](https://github.com/mpv-player/mpv/tree/0b7ed670f)。本工程复现固定二进制的打包；上游部分原生依赖采用浮动提交，不能据此声称原生编译结果逐字节可复现。

mpv 默认构建为 GPLv2 或更新版，上游 FFmpeg 开启 GPL 和 version3，因此本原生组合适用 GPLv3 或更新版。MIT、GPL、LGPL、Apache 及依赖许可文本在 `app/src/main/assets/licenses/` 并随 APK 打包。JNI 来源哈希和二进制哈希分别在构建脚本与锁文件记录。对外公开分发时需同时准备完整对应原生源码及实际解析的依赖提交；本次交付是本地开发版本。
