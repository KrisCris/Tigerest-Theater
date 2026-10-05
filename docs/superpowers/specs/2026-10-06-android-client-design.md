# EMBY 大河版安卓客户端设计

日期：2026-10-06

桌面基线：V2.4.1，提交 `e5f9b9d6a9d35808d27621111930500f92c80f49`

阶段：用户已确认推荐架构；本文待用户审阅，随后编写实施计划。

## 1. 目标与交付标准

以当前 EMBY 大河版为蓝本，新增可安装的 Android 客户端，最低系统版本为 Android 15（API 35）。在普通手机、折叠屏、安卓平板及系统允许的分屏、自由窗口中，界面随当前可用窗口尺寸变化。保留现有深色背景、金色强调色、封面和详情布局、圆角、消息与评论交互。

必须实际接通以下完整路径：

- 服务器选择、连接、登录、媒体库浏览、搜索、详情、选集，以及现有网页 UI/CSS。
- 消息中心的收到回复、我的发言、未读状态、分页、全部已读及评论定位。
- 作品/本集评论、回复、分页、本人删除、身份及访问权限处理；有权限账号保留已有评论管理入口。
- 网页中的基础客户端设置，保存、读取、恢复默认及支持即时生效的项目。
- 内置 libmpv：网络播放、暂停、继续、拖动、倍速、音轨、内置/外挂字幕、音画及字幕偏移、观看进度回传。
- 弹幕自动匹配、手动搜索和选择、加载、开关、样式、来源屏蔽与时间偏移；暂停、跳转、倍速和切集时正确同步。
- 窗口调整、旋转和折叠状态变化时保留当前页面、登录状态与播放会话；界面和输入区不被系统栏、挖孔、键盘或分离式折痕遮挡。

最终交付可安装 APK、完整源代码、固定依赖清单、构建与安装说明、APK SHA-256，以及分层测试报告。单纯网页容器、外部播放器跳转、空实现设置或只有弹幕演示均不满足交付标准。

用户已授权通过 USB/ADB 在所连接手机上测试；设备解锁信息只用于确有必要的解锁操作，不进入源码、配置、构建产物或测试报告。

## 2. 已核实的项目与环境

现有程序采用 Qt/QML + Qt WebEngine + libmpv。网页由连接的 Emby Server 提供，桌面端注入本仓库的 `native/` 扩展，而非在本仓库维护一份完整 Emby 网页源码。

可直接复用的主要文件：

- `native/webAppearance.js`：现有主题、动效及组件 CSS。
- `native/communityClient.js`、`communityMessages.js`、`communityPlugin.js`：评论协议、消息列表和详情评论 UI。
- `native/nativeshell.js`、`embycompat.js`：AppHost、客户端设置、插件与网页路由注册。
- `native/mpvVideoPlayer.js`、`mpvAudioPlayer.js`、`sessionNavigationPlugin.js`：播放器插件、播放事件和导航行为。
- `native/find-webclient.*`：首次连接界面。
- `resources/settings/settings_description.json`：已有设置结构与默认值。
- `src/player/PlaybackIdentity.cpp` 与弹幕 Lua：作品/季/集元数据语义和现有弹幕行为参考。

2026-10-06 的只读核查确认：局域网 Emby 的公开信息接口可访问，版本为 `4.10.0.40`；`/web/index.html` 返回 HTTP 200，使用现有 AMD 加载机制，响应没有 CSP 头。此结果只证明公开网页可获取，没有验证登录账号、媒体访问或生产消息/评论接口。

本机 ADB 位于 `C:/platform-tools-latest-windows/platform-tools/adb.exe`，版本 35.0.2。首次核查没有设备；用户重新插拔后已成功连接，状态为 `device`。实测设备型号 `24072PX77C`，Android 16（API 36），仅支持 `arm64-v8a`，内存页大小 4096。当前物理显示尺寸为 1080×2520，物理 density 480，已有用户 density override 420；WebView 为 `com.google.android.webview` 153.0.8010.36。未修改任何显示设置，后续测试恢复时须保留已有 override 420。该设备不能代替 16 KB 环境验证。

当前未在 PATH 或常见 SDK 位置发现可用安卓 SDK、Java 和 Gradle；Docker CLI 存在，但 Linux 引擎未运行。后续在独立依赖目录准备安卓工具链。mpv-android 上游明确原生构建使用 Linux/macOS，不直接采用其 Windows/WSL 构建路径。

## 3. 架构与工程边界

采用用户确认的 **Kotlin 安卓壳 + Android WebView + JNI/libmpv + 安卓弹幕渲染层**。

在仓库新增 `android/` Gradle 工程，Android 的应用、原生桥接、平台设置和打包工具均在此目录。桌面 CMake 构建保持独立。共享网页文件只做必要的平台能力入口调整；安卓打包时从当前仓库生成网页 assets，避免手工复制出一套长期不同步的消息、评论和主题代码。

组成如下：

1. **WebHost**：WebView、连接引导、原点与导航策略、文档开始时注入、文件选择、网页状态。
2. **AndroidBridge**：适配现有 `window.api` 方法和信号；Kotlin 端显式分发允许调用的方法。
3. **PlaybackController**：libmpv 的加载、事件、音轨字幕、媒体会话、音频焦点、Surface 和生命周期。
4. **DanmakuController/Overlay**：网络匹配、解析、来源设置、时间轴、布局与屏幕刷新驱动。
5. **SettingsStore**：安卓支持的设置、类型/范围校验、持久化、变化通知。
6. **WindowLayoutController**：当前窗口尺寸、系统/键盘 Insets、折痕与显示刷新率。

最低 SDK 固定为 35，编译及目标 SDK 为 36；ARM64 为手机/平板正式构建，x86_64 为模拟器验证构建。兼容 Android 15 及更新系统不能以目标 SDK 声明代替运行测试。

## 4. 网页复用与原生桥接

首次连接页面作为应用内 assets 提供；媒体库、登录、详情及网页主应用继续从所选 Emby Server 加载。通过 AndroidX WebKit 在文档开始时安装 `jmpInfo`、安卓 API 适配器及已有插件，确保在 Emby AppHost/AMD 初始化前完成注册。检查 WebView 的相关特性支持；缺失必要能力时给出可操作的初始化错误，不静默退回没有客户端功能的普通网页。

共享 `createApi()` 增加安卓适配入口；桌面仍走原有 QWebChannel。安卓暴露兼容的方法返回值、Promise 和 `connect`/`disconnect` 信号，而不是伪造成功或通过反射开放任意 Kotlin 对象。

播放器 API 保留现有单位：位置、拖动、偏移和时长以毫秒传递，播放倍率使用现有桥接约定；在 JNI 边界转换到 mpv 对应类型。契约测试覆盖转换，防止毫秒/秒和倍率错位。

播放信号至少包括 playing、paused、positionUpdate、updateDuration、buffering、bufferedRangesUpdated、stateChanged、finished、stopped、canceled、error、videoPlaybackActive、windowVisible 和网页实际依赖的元数据/矩形信号。每次播放有独立 generation；旧视频、旧网页或旧账号的异步回调不能污染新会话。自然结束、主动停止、切流和错误保持不同语义，避免重复进度回传或错误进入下一集。

桥接只在主框架的应用内引导页面及已选 Emby 原点启用。自建服务器验证完整 HTTP(S) 地址、端口和反向代理前缀后，按明确原点注册。外部链接由系统打开；非受信页面、子框架或跳转后的未知原点不能使用客户端桥接。

消息及评论复用现有协议和账号信任规则：大河服务器显示，自建 Emby 不因安卓迁移自动获得评论服务权限。保留超时、取消、幂等提交、频率限制、草稿处理、已删除占位、账号切换清理及头像认证。若需原生网络中转，限制到对应服务端点和请求类型，并保持现有取消/错误语义，不设置全局关闭网页安全的开关。

## 5. mpv、依赖与播放生命周期

libmpv 和必要解码/字幕依赖打包在 APK 内，JNI 包装由本工程维护。构建参考 mpv-android 上游；原生运行库候选固定为官方 `2026-09-17` 发布，不使用浮动 latest URL。实际采用的资产、SHA-256、源代码版本、ABI、依赖和许可证写入版本化清单。

采用候选前检查其原生库和 APK 对齐、符号依赖、Android API 要求与运行行为。候选不满足要求时，在 Linux 构建环境用固定来源与 NDK r28+ 重建；不能以“等待运行库放入目录”的骨架作为最终结果。所有随包 `.so` 验证 16 KB ELF 对齐与 APK ZIP 对齐，并在 16 KB 环境执行运行验证。

播放器使用 Android Surface 承载真实 mpv 输出。默认使用 Android 硬解能力，支持软件解码配置。颜色、HDR、复杂字幕和编码支持以实际 mpv/设备能力及样本结果报告，不直接沿用桌面声称的支持范围。

独立 PlaybackController 持有 mpv 实例与播放状态。改变窗口、旋转或折叠时重新布局/绑定 Surface，不重新请求整集播放。配置重建通过保留控制器和显式 Surface detach/attach 处理；系统杀进程后恢复页面与可恢复的播放信息，不能保证被杀的进程仍连续播放。

实现 Android 音频焦点、耳机断开、返回导航和停止行为。前台视频播放时保持屏幕唤醒；后台视频默认暂停，回到前台尊重用户原来的暂停状态。音频播放如继续到后台，使用正确类型的媒体前台服务和媒体会话。画中画和后台持续视频不作为本次必须交付项。

安卓播放器控制层沿用深色/金色视觉语言，提供适合触屏的播放、时间轴、倍速、选集、音轨、字幕、弹幕与返回入口，并与网页播放插件共享同一会话。只有网页现有画面在移动设备上真实可用且验证通过的控件才继续复用；不能依赖鼠标悬浮才出现的操作。

## 6. 弹幕迁移

桌面 Lua 的网络请求使用外部 `curl`，不能直接作为安卓网络实现。安卓使用应用内 HTTP 客户端，沿用当前弹幕服务选择规则和 API 数据结构；不要求手机安装命令行程序或另一个播放器。

自动匹配优先使用 Emby 的 SeriesName、ParentIndexNumber、IndexNumber 与名称，沿用现有特殊集数/季数处理语义。手动搜索可选择作品和集数，覆盖自动匹配失败的情况。保留各来源的开关、偏移和历史匹配，不把屏蔽状态在切集后重置。

支持现有服务 JSON 及本地 XML/ASS 弹幕输入；本地文件通过系统文件选择器和授予的 URI 读取。远程来源使用当前服务支持的扩展来源接口；平台特有抓取行为逐项移植并验证，未实现的能力不能显示为可用。

样式至少复用现有 bold、fontsize、outline、shadow、scrolltime、opacity、displayarea。文字移动、顶部和底部固定显示采用受控轨道布局，避免同轨追尾；屏幕与窗口变化重新计算可用区域，并与字幕、控制栏及折痕避让策略协调。

弹幕时间源为 mpv 实际 time-pos，使用单调时钟在已知播放速度下短期推算；暂停/缓冲立即停止推进，seek 重建可见集合，切集清空旧任务，倍率变化重同步。通过 Choreographer 按当前显示器帧回调绘制，不让弹幕速度跟着视频帧数变化。高刷性能报告包含测量数据，不把请求 120 Hz 等同于达成 120 fps。

## 7. 设置和尺寸适配

从共享设置描述中筛选并补充安卓能力。基础设置覆盖服务器入口/重置、网页缩放、硬解、缓存、默认播放速度、画面比例、音频与字幕偏移、字幕样式和语言偏好、弹幕开关及样式。值保存到应用私有配置，修改后通知网页快照，并将应即时生效的设置应用到当前会话。

Windows 托盘/任务栏、桌面音频设备独占、Windows/macOS RIFE 扩展及桌面系统 mpv 路径不出现在安卓设置中。安卓不把不支持的设置显示为可保存的成功操作。共享设置 UI 保留搜索、分类和恢复默认功能。

布局按 **当前窗口可用宽度**，不按设备型号或屏幕固定分辨率：

- 紧凑窗口：单列详情，设置分类可横向滚动，消息和评论控件适合拇指操作。
- 中等窗口：扩大封面列数与详情可用空间，适用于折叠屏内屏/部分平板窗口。
- 宽窗口：沿用桌面更舒展的详情、设置侧栏和多列媒体卡片。

具体断点以网页 CSS 和安卓 WindowMetrics 的可用宽度校验，并覆盖 360、412、600、840 和 1200 CSS 像素窗口。安卓视图的 dp 与网页 CSS 像素分别计算，不能直接混用屏幕物理像素。

声明 resizableActivity，不锁定横竖屏或固定宽高比。使用 WindowManager 获取折痕，分离式铰链两侧的交互与视频控制不跨越不可用区域。处理 edge-to-edge、状态栏、导航栏、挖孔、自由窗口标题区和键盘 Insets；评论输入框打开键盘后仍可看见正文和提交按钮。折叠、分屏拖动和自由窗口调整不重置路由、表单草稿或播放时间。

## 8. 测试与证据边界

使用独立测试包标识和应用数据，保持电脑已安装客户端与设置不变。不得把真实认证信息复制到 fixture，也不把解锁信息写入 adb 脚本或测试日志。

验证分为四层并单独记录：

1. **静态与契约检查**：安卓构建、Lint、网页脚本语法、共享资产同步、桥接方法/事件/单位/取消语义、来源与输入校验、依赖锁和 16 KB 对齐。
2. **隔离 fixture 集成**：完整 Emby 网页加载/注册流程，账号切换，消息分页/未读/定位，评论/回复/草稿/幂等与错误，设置保存/重启恢复，mpv 事件与进度回传。测试写入只发生在隔离服务。
3. **安卓模拟器与布局**：API 35、36，普通手机、可折叠和平板尺寸；横竖屏、分屏、自由窗口、键盘、折痕、退出/重入和 16 KB 环境。截图和自动断言共同证明控件可见、可点击及状态保留。
4. **USB 真机**：实际 APK 安装启动、设备/WebView/ABI/内存页记录，真实音视频解码、seek、暂停、音轨、字幕、倍速、切集、弹幕同步和窗口变化。测试素材与 fixture 先覆盖完整功能，再对生产 Emby 做有授权账号的只读浏览与播放检查。

生产评论发送/删除、禁言或全部已读等会改变真实服务状态的操作不用于测试；只读生产结果不能替代 fixture 对这些功能的验证。真实登录若需要独立测试账号，以用户提供或明确选择的账号进行，不提取桌面保存凭据。网络播放进度属于用户授权的播放测试，报告说明测试媒体与影响。

ADB 尺寸/方向等系统设置若临时改变，记录原值并在结束时恢复。一次手机实测不等于全部设备型号认证；模拟器/窗口尺寸测试、真机测试和生产接口测试分别写明覆盖与未覆盖项目。

若后续必须运行 Windows CTest 或原生 `.exe`，先阅读 `dev/windows/TESTING.md`，并在执行测试的同一次 PowerShell 调用中 dot-source `dev/windows/Enter-TestEnvironment.ps1`；DLL/Qt 插件预检失败立即停止并修复环境。

## 9. 实施顺序与完成判定

实施计划按可验收的纵向路径安排：工具链及可重复的原生依赖 → WebHost/桥接/连接登录 → 真正 mpv 播放及回传 → 消息评论/设置全部接通 → 弹幕 → 旋转折叠及窗口适配 → 集成测试、真机回归和 APK 交付。任何先完成的壳或演示 APK 都标明阶段产物。

只有第 1 节的必需功能完成、对应测试有实际结果，且 APK 包含验证过的原生运行库时，才声称安卓客户端完成。ADB 未连接、缺少测试账号、16 KB 环境或未实测机型均写成明确验证限制；这些限制不隐藏在“兼容安卓 15+”的概括声明中。

## 10. 核查依据

- [Android 15：edge-to-edge 与窗口 Insets](https://developer.android.com/about/versions/15/behavior-changes-15)
- [Android 16：大屏方向、宽高比与窗口可调整大小](https://developer.android.com/about/versions/16/behavior-changes-16)
- [Android 16 KB 内存页支持及原生库对齐](https://developer.android.com/guide/practices/page-sizes)
- [AndroidX WebViewCompat 文档开始注入与消息通信 API](https://developer.android.com/reference/androidx/webkit/WebViewCompat)
- [mpv-android 官方项目](https://github.com/mpv-android/mpv-android)
- [mpv-android 原生构建说明](https://github.com/mpv-android/mpv-android/blob/master/buildscripts/README.md)
- [mpv-android 固定候选发行版](https://github.com/mpv-android/mpv-android/releases/tag/2026-09-17)
- [Qt WebEngine 6.9 平台说明](https://doc.qt.io/archives/qt-6.9/qtwebengine-platform-notes.html)
