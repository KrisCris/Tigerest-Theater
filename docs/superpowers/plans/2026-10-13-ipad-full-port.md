# iPad Full Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在免费 Personal Team 下交付 iPad 首版，完成设计规定的媒体、社区、弹幕、设置和离线功能并如实记录平台验证边界。

**Architecture:** SwiftUI/UIKit 应用壳承载 WKWebView 和 libmpv。共享网页由 `native/` 构建生成，平台桥接与 Swift 核心分别测试。下载、凭据和配置档各自拥有明确的数据范围。

**Tech Stack:** Xcode 27 beta、Swift、UIKit、WebKit、libmpv/FFmpeg/libass、Foundation/URLSession、Security/Keychain、Swift Testing、Node test runner、Python 构建工具。

**Spec:** `docs/superpowers/specs/2026-10-13-ipad-full-port-design.md`

## Global Constraints

- 最低系统：iPadOS 26.0。只创建 iPad App，后续 tvOS 26.0+ 不进入本次交付。
- 使用 Xcode 27 beta，支持 `DEVELOPER_DIR`，不能落回 Command Line Tools 或 Xcode 26。
- 免费 Apple 账号、Personal Team、Automatic Signing；个人 Team ID 和设备标识只作为本机构建参数。
- 所有必需功能属于同一个首版，分任务完成不等于分割首版范围。
- 不把 iPad 冒充 Android；共享前端使用明确的平台能力。
- 不关闭 TLS 校验；会话、下载、缓存、诊断按配置档和账号隔离。
- 本地测试服务覆盖生产写操作，不向公开评论、报错或共享纠正接口发送测试垃圾。
- RIFE 需要完整链路证据；未通过只报告真实限制，不提供假开关。
- 源码、日志、构建产物和 Git 不包含账号密码、Token、证书、私钥、设备标识。

## Review Focus

- 带反向代理子路径的服务器与跨源重定向：保留路径、禁止携带凭据跳转至其他源；Task 1/3/5 验证。
- 播放停止、切集与网页重载同时发生：旧回调不得结束新媒体；Task 2/4 验证。
- 退出或换配置档时仍在下载或上传头像：不能把旧数据/凭据写入新配置；Task 1/5/7 验证。
- 续传响应退回 200、返回错误范围或 ETag 变化：不能产生拼接损坏或假完成；Task 7 验证。
- 断网冷启动与锁屏后返回：离线入口独立于远程页面，播放/亮度/音频状态正确恢复；Task 4/7/9 验证。

## File Structure

- `apple/Core/`：可在 Mac 运行 Swift Testing 的 AppleCore 包，存放地址、桥接、设置、队列、弹幕和下载策略。
- `apple/App/`：iPad 应用入口、WebHost、原生桥接、播放 UI、平台服务与离线 UI。
- `apple/Resources/`：iPad 注入脚本和适配样式；共享内容由打包脚本同步。
- `apple/Tests/`：网页桥接和资源构建测试；`apple/UITests/`：真机/模拟器 UI 测试。
- `apple/tools/`：工程生成、资源同步、构建、安装、验收工具。
- `apple/dependencies.lock.json`：固定第三方源码、产物版本及校验值。
- `apple/TigerestTheater.xcodeproj`：可直接在 Xcode 打开的工程；支持本机自动签名。
- `native/`：仅修改平台能力和必要的跨平台入口。
- `docs/releases/2026-10-13-ipad-port-validation.md`：实际测试和未验证项。

统一运行环境：先将 `DEVELOPER_DIR` 指向已安装的 Xcode 27 beta。以下 `swift`/`xcodebuild` 均继承该变量。

## Task 1: 配置、地址与隔离核心

**Files:** Create `apple/Core/Package.swift`, `Sources/AppleCore/{ServerAddress,JSONValue,BridgeEnvelope,ProfileStore,SettingsPolicy}.swift`, `Tests/AppleCoreTests/{ServerAddressTests,BridgePolicyTests,ProfileStoreTests,SettingsPolicyTests}.swift`。

**Interfaces:**
- `ServerAddress.init(_ input: String) throws`，输出 `baseURL: URL`、`origin: String`、`endpoint(_ path: String) -> URL`。
- `JSONValue: Codable, Sendable, Equatable` 表示桥接 JSON；`BridgeRequest` 含 `id/component/method/args`。
- `BridgePolicy.allows(origin: String, isMainFrame: Bool) -> Bool`；`advancePage() -> UInt64` 和 `isCurrent(_ epoch: UInt64) -> Bool`。
- `ProfileStore` 提供当前 UUID、配置目录和 `select(_ id: UUID)`；`SettingsPolicy.validate(section:key:value:) throws -> JSONValue`。

- [ ] 先写测试：HTTPS 子路径和端口保持；拒绝 file/javascript/嵌入凭据/路径逃逸；拒绝 iframe 和旧页面回调；两配置设置与目录不混用；拒绝非有限数字和错误设置类型。
- [ ] 运行 `swift test --package-path apple/Core`，确认缺少相应行为时失败；补齐纯 Swift 核心。
- [ ] 同一命令通过全部核心用例，提交该模块。

## Task 2: 网页桥接契约与共享资源

**Files:** Create `apple/Resources/ipadBridge.js`, `ipadResponsive.css`, `ipadResponsive.js`, `apple/Tests/bridge.test.cjs`, `apple/tools/sync_resources.py`; modify `native/{nativeshell,embycompat,webAppearance,updatePlugin}.js` 按实际能力入口需要调整。

**Interfaces:**
- `createIPadBridge(transport, bootstrap)` 返回 `{api, receive(message), close()}`；请求 `{id,component,method,args}`，回复 `{id,result|error}`，信号 `{component,signal,args}`。
- `window.tigerestIPadApi` 与 `jmpInfo.platform === 'ipad'` 标识平台；`jmpInfo.capabilities` 包含 `downloads/nativePlayback/desktopWindowControls`。
- `sync_resources.py --output DIR` 从当前仓库生成共享资源、设置描述与来源清单；不包含任何本机数据。

- [ ] 先写 Node 行为测试：Promise/回调、超时、信号顺序、关闭时拒绝未完成请求、迟到响应不触发新会话；能力不能关闭 iPad 下载或显示桌面窗口按钮。
- [ ] 运行 `node --test apple/Tests/bridge.test.cjs` 观察失败，再实现桥接与最小共享入口变更。
- [ ] 运行上述测试和 `node --test android/tests/test_android_bridge.cjs tests/test_nativeshell_window_button.cjs tests/test_player_lifecycle.js`，验证跨平台回归；提交。

## Task 3: 可安装应用与 WebKit 登录流程

**Files:** Create `apple/App/{TigerestApp,AppModel,WebHost,NativeBridge,AssetSchemeHandler,SettingsStore,KeychainStore,OnboardingView}.swift`, `apple/tools/{generate_project,build}.py`, `apple/Config/Info.plist`, `apple/UITests/WebHostTests.swift`。

**Interfaces:**
- `AppModel` 持有配置档与平台服务；`NativeBridge.handle(_ request: BridgeRequest, context: BridgeContext) async throws -> JSONValue`。
- `NativeBridge.emit(component:signal:args:)` 回传指定代次页面；`WebHost.open(_ address: ServerAddress)` 只导航当前受信源。
- `AssetSchemeHandler` 仅从生成的包资源处理 GET，不读取用户文件。
- `KeychainStore` 按配置档/服务器/账号组合 key 保存社区凭据；不向控制台输出内容。

- [ ] 先写受控页面 UI 测试：连接页加载、子路径导航、文档初始注入、非法源拒绝、旧回调丢弃、HTTPS 资源加载失败可恢复。
- [ ] 生成 Xcode 工程并实现 SwiftUI/UIKit 壳；Team ID 留作本机参数，Deployment Target 为 26.0，device family 为 iPad。
- [ ] `xcodebuild -project apple/TigerestTheater.xcodeproj -scheme TigerestTheater -sdk iphoneos -configuration Debug CODE_SIGNING_ALLOWED=NO build` 成功后，在 Personal Team 下签名安装并启动；两类结果分别记录。
- [ ] 真实浏览先由用户在应用中登录 Emby，后续仅使用运行时会话；提交应用壳和登录流程。

## Task 4: MPV 播放器、菜单与媒体会话

**Files:** Create `apple/App/Playback/{MPVEngine,PlaybackController,PlayerSurface,PlayerView,PlayerControls,MediaSession,FileImportCoordinator}.swift`, `apple/Core/Sources/AppleCore/{PlaybackState,PlaybackContract,EpisodeQueue,TemporarySpeed}.swift` 及对应核心测试；create `apple/dependencies.lock.json`, `apple/UITests/PlaybackTests.swift`。

**Interfaces:**
- `MPVEngine` 包装命令、属性和事件，不拥有网页；依赖固定的 iOS libmpv 构建。
- `PlaybackController.dispatch(method: String, args: [JSONValue]) async throws -> JSONValue` 使用 Task 2 的 player 方法与信号。
- `PlaybackState.begin() -> UInt64`、`finish(generation:) -> Bool`；旧代次和重复结束不得产生新的终止事件。
- `EpisodeQueue` 提供当前 ID、前后项和来自网页的真实队列；通过 `input.playlistItemRequested` 请求网页切集。

- [ ] 先测试 `#1`/空/负轨道选择、毫秒与倍速单位、旧代次结束、暂停意图、临时倍速恢复、真实队列边界和 30 秒无进展超时。
- [ ] 固定运行库来源和校验值，验证 iOS/模拟器架构；接入渲染、VideoToolbox、音频、轨道及字幕，处理所有声明支持的桥接操作。
- [ ] 加入原生播放控制、手势、键盘、防误触、字幕导入和媒体会话；中断/路由变化尊重用户暂停意图，退出恢复亮度。
- [ ] 核心测试通过，并用真实媒体完成 20 次切集/停止/重播、20 次定位；覆盖旋转、尺寸变化、锁屏和音频中断，日志确认实际硬解与渲染状态；提交。

## Task 5: 社区、消息、报错与诊断

**Files:** Create `apple/App/Community/{CommunityTransport,CommunityPolicy,AvatarTransport}.swift`, `apple/App/Diagnostics/DiagnosticsLog.swift`, `apple/Core/Tests/AppleCoreTests/CommunityPolicyTests.swift`, `apple/Tests/community.test.cjs`；复用 `native/community*.js`。

**Interfaces:**
- `CommunityTransport.request(id: String, request: JSONValue, scope: SessionScope)` 通过 `system.communityResponse` 返回结果；`cancel(id:)` 取消对应任务。
- 凭据桥接语义对齐 Android `CommunityBridge`；`setSession(_:)` 更新资格并通知弹幕共享匹配服务。
- `DiagnosticsLog.record(level: String, message: String)`、`collect(scope:)` 生成有界脱敏数据。

- [ ] 先测试端点/方法/请求头允许表、跨源重定向拒绝、退出时旧头像/请求失效；诊断夹具中 Token/密码/认证 URL 必须消失。
- [ ] 实现 URLSession 传输、Keychain、头像和诊断；共享网页贯通评论账号、改密码、回复、管理、消息和报错。
- [ ] 运行 `node --test tests/test_community_bridge.js tests/test_community_client.js tests/test_community_v2.js tests/test_community_avatar.js` 与 iPad 桥接测试；受控服务验收重试幂等、草稿、全部已读快照；提交。

## Task 6: 弹幕匹配、导入和原生绘制

**Files:** Create `apple/Core/Sources/AppleCore/Danmaku/{DanmakuParser,DanmakuMatch,DanmakuTimeline,DanmakuClock}.swift`, 对应核心测试；create `apple/App/Danmaku/{DanmakuRepository,DanmakuOverlay,DanmakuControls}.swift`。

**Interfaces:**
- `DanmakuComment` 含时间、文本、颜色、模式、来源；`DanmakuParser.parse(data:format:) throws -> [DanmakuComment]`。
- Repository 实现 `search/episodes/match/load/loadUrl/importFile/setSource/sources/setEnabled` 并发出 `status/sourcesChanged`。
- `DanmakuClock.position(mediaTime:hostTime:playing:rate:epoch:)` 输出与媒体一致的时间，依赖 Task 4 播放快照。

- [ ] 先测试 XML/JSON/ASS 的手工样本、错误/过大输入、续季/集标题匹配、取消旧请求、暂停/倍速/定位时间轴和源屏蔽。
- [ ] 移植已有 Android 匹配与协议语义；使用 Task 5 会话资格；原生 overlay 随屏幕时钟绘制并在旋转时重排。
- [ ] 测试通过，真机确认播放不被弹幕加载阻塞，手动选择和共享保存失败提示有效；提交。

## Task 7: 下载、离线启动与配置档

**Files:** Create `apple/Core/Sources/AppleCore/Downloads/{DownloadRecord,ResumePolicy,OfflineProgress}.swift` 及测试；create `apple/App/Downloads/{DownloadCoordinator,DownloadStore,OfflineLibraryView}.swift`, `apple/App/ProfileManagerView.swift`。

**Interfaces:**
- `DownloadCoordinator` 适配 `native/offline.js` 的真实 system 方法与信号；URLSession 后台任务包含稳定配置档任务 ID。
- `ResumePolicy.decide(status:headers:received:validator:)` 返回 append/restart/complete/reject，不能凭 HTTP 成功码认定可追加。
- `OfflineLibraryView` 从 AppModel 直接打开；使用 Task 4 播放本地媒体，不要求 WebHost 先联网成功。

- [ ] 先测试正确 206、退回 200、416、范围不符、ETag 变化、部分文件不能完成、重启恢复和账号切换；离线进度不能覆盖较新的服务端状态。
- [ ] 实现持久化和后台下载、字幕/弹幕资源、本地播放与配置档管理；导入文件使用授权目录或复制到应用沙盒。
- [ ] 受控下载服务制造断流和错误范围，真机断网冷启动后可播放完整文件；删除仅影响当前配置；提交。

## Task 8: 画质、系统适配与 RIFE 验证

**Files:** Create `apple/App/Playback/QualitySettings.swift`, `apple/Core/Sources/AppleCore/MPVConfigurationPolicy.swift` 及测试；create `apple/tools/rife_probe/` 中必要的独立验证代码与 `apple/reports/rife-feasibility.md`。

**Interfaces:**
- `MPVConfigurationPolicy` 对导入配置与预设产生允许参数集；拒绝外部进程、沙盒外路径和不支持的平台选项。
- RIFE 依赖 Task 4 的实际帧链路，只有经过完整性能门槛才加入 capability，不以模型可加载作为启用条件。

- [ ] 先测试允许 shader/配置导入与拒绝外部路径/执行，验证能力过滤和即时/下次播放生效边界。
- [ ] 测量真实 shader、HDR10/HLG/Dolby Vision 与不同编解码路径，记录支持范围；无相应素材的项标记未验证。
- [ ] 检查 Mac RIFE 模型与帧接口的 iOS 可用性，完成可执行的推理与接入验证；若可完整接入，运行 10 分钟 1080p/30 SDR → 2× 测试，否则记录具体阻断及证据；提交。

## Task 9: 集成验收、文档与最终审阅

**Files:** Create `apple/README.md`, `apple/tools/validate.py`, `docs/releases/2026-10-13-ipad-port-validation.md`；按已实现能力更新用户文档。

**Interfaces:** 验收脚本运行核心、桥接、资源、Xcode 构建和产物校验；不会自动向生产社区写入。

- [ ] 运行 `swift test --package-path apple/Core`、`node --test apple/Tests/*.test.cjs`、所触及共享模块的回归和 Xcode 构建/UI 测试；保存实际结果。
- [ ] 在 iPadOS 26 环境与已有 27.2 真机上分别验证；没有对应环境时把缺口保留为未完成验收，不用 Deployment Target 代替实测。
- [ ] 免费账号签名安装、重复安装保留数据、离线冷启动及真实媒体检查；生成构建哈希和来源清单。
- [ ] 请求一次独立的整分支代码审阅，修复有实际影响的问题并回归；仅在完整必需清单通过后报告首版完成。

## Execution Record

用户已于设计审阅后指示“动手吧”。本会话直接实施，保持可恢复任务记录；不在每个模块完成后重复请求继续授权。设计与本计划始终可供用户查看并随新约束修订。
