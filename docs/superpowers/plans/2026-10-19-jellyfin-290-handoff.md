# Jellyfin 2.9.0 实现与验收交接

2026-10-19，按用户在 Codex 聊天中的分工安排：Codex 先完成接口报告和文档；Claude 集中完成代码；实现完成后将审查与测试交回 Codex。完整需求仍是首页去重修复加全平台 Jellyfin 兼容、目标版本 2.9.0，不缩减为单纯能登录或播放。

## 工作区与已找到的计划

- Claude 工作区：`C:/Users/59890/Documents/ChatGPT/EMBY大河版/.claude/worktrees/jellyfin-290`
- 分支：`claude/jellyfin-2.9.0`
- 基线：`2f5e06c97bd6c9cd4cdc1f5b4fe84c3813a69857`，已包含 2.8.1 首页去重。
- 父目录仍是 `claude/windows-frame-pacing`、旧 2.6.1；不要在那里继续本轮代码或误用它的构建产物。
- 找到的是 Claude 会话内 `update_plan` 计划；仓库根 `PLAN.md` 是历史 2.0.11 计划，不是本轮计划。本文件为本轮分工提供持久入口，不改写 Claude 会话记录。

| Claude 原计划项 | 接手时状态 | 当前责任 |
| --- | --- | --- |
| 查看仓库结构与首页重复番剧修复现状 | 已完成 | 保留既有结论 |
| 梳理各平台 Emby API 调用点 | 进行中 | Codex 已补接口报告；Claude 按报告实现并核对 |
| 起多版本 Jellyfin 测试服并实测差异 | 待完成，便携包后台下载 | Codex 在实现后接手 |
| 实现桌面/网页注入层 Jellyfin 兼容 | 已有未提交初步修改 | Claude |
| 实现 Android 与 Apple 端 Jellyfin 兼容 | 未完成 | Claude |
| 版本号更新至 2.9.0 并写更新说明 | 未完成 | 版本字段由 Claude；文档草案由 Codex 完成 |
| 跑测试并对各版本服务器实测 | 待完成 | Codex；Claude 可做必要的小范围自检 |
| 提交并清理测试服务器 | 待完成 | 实现交接时标明提交状态；测试资源由 Codex 收尾 |

## Codex 已准备的文档

1. [接口报告](../../reports/2026-10-19-jellyfin-api-audit.md)：调用点、路由映射、按版本字段差异、鉴权与资源路径，附官方源码出处。
2. [审查与验收方案](../../verification/2026-10-19-jellyfin-2.9.0.md)：分层测试、已有命令、五版本五端矩阵、环境与证据要求。
3. [Jellyfin 连接说明](../../jellyfin-compatibility.md)：地址、账号、权限和平台边界。
4. [2.9.0 更新说明草案](../../releases/2026-10-19-v2.9.0.md)：用户可读更新范围，明确尚未发布/验收。

README、更新记录及相关使用入口只添加开发版文档入口，不把旧正式版本标记为已支持 Jellyfin。审查和实测完成后由 Codex 按实际结果整理正式发布状态。

## Claude 的实现清单

- 完成共用服务识别、鉴权和 URL 适配；注意冷启动异步探测、缓存与切服。已有 `native/serverKind.js` 及播放器初改由 Claude 继续负责，Codex 没有修改这些源码。
- 检查 `embycompat.js` 与 Jellyfin NativeShell 的注册边界；共享首页、设置、导航、评论不能只在 Emby 注册成功。
- 优先处理接口报告中的 Fields 枚举差异；JS 首页与 Swift 首页/详情请求都要覆盖。
- 完成 AppleCore 原生 HTTP 客户端的服务类型、持久化兼容、鉴权、路由、图片、字幕、播放与上报；不要只改网页注入。
- 保留原有首页身份去重和社区权限边界，不扩大 Android/tvOS 的平台功能承诺。
- 按最终代码补必要回归测试和轻量自检。完整构建、服务器环境排障、跨平台验收和结果报告交 Codex，避免重复消耗。

### 版本字段

| 文件 | 基线 | 2.9.0 目标 |
| --- | --- | --- |
| `VERSION` | 2.8.1 | 2.9.0，桌面公共版本源 |
| `android/app/build.gradle.kts` | 2.8.1 / 2080100 | 2.9.0 / 2090000，沿现有编码规则 |
| `apple/Config/Info.plist` | 2.8.0 / 280 | 2.9.0 / 290，或符合既有发布序列的更高构建号 |
| `apple/Config/TVInfo.plist` | 2.8.0 / 280 | 2.9.0 / 290，或符合既有发布序列的更高构建号 |
| `apple/Core/Sources/AppleCore/Emby/EmbyClient.swift` | 鉴权客户端版本硬编码 2.8.0 | 与本轮客户端版本一致，避免遗漏硬编码 |
| `resources/rife/windows-catalog.json` | 兼容列表含 2.8.1 | 检查并加入 2.9.0，不改扩展哈希冒充新包 |

生成的工程、资源索引、打包元数据按现有生成脚本同步；不把历史 release 文档中的旧版本全局替换。

## 已有环境与下载

Claude 会话记录显示 Docker 因虚拟化平台问题未启动，已转 Windows 便携包；本轮不继续重置 Docker/WSL。下载目录为：

`C:/Users/59890/AppData/Local/Temp/claude/C--Users-59890--claude-spares-spare-kisyIg/f439888e-cc82-4885-9c65-5550838ceac4/scratchpad/jf/dl`

已观察到 `jf-10.9.11.zip`、`jf-10.10.7.zip`、`jf-10.11.0.zip`、`jf-10.11.11.zip`、`jf-12.2.zip`、`ffmpeg.zip`。存在不等于完整；下载结果、校验、解压和启动由测试阶段确认，不删除仍在写入的文件。所有后台任务及新建服务交接时说明状态。

## 交还 Codex

Claude 完成后提供：提交号或完整未提交文件清单、各平台实际实现范围、已跑自检及结果、剩余问题、后台任务/临时服务状态。明确说明“实现完成，待 Codex 审查和测试”，不要把代码完成写成所有平台验收通过。

Codex 接收固定源码后依次完成 diff 审查、必要修复核对、隔离构建、模拟测试、真实服务器 API、可用设备播放验证，再更新报告。没有 Apple 环境或真机时记录阻塞，不能用 Windows/fixture 结果代替。

## 用户追加的直接交接安排

用户已在本轮 Codex 聊天中明确授权后续直接交接，无需用户来回传话：Claude 实现完成后 Codex 审查和测试；发现问题且 Claude 仍有可用额度时，由 Codex 直接向同一 Claude 会话反馈可复现问题并请其修复；Claude 额度耗尽时，Codex 接手剩余实现或修复，并继续验证。

- Claude 会话名：`Jellyfin适配兼容与2.9.0更新`。反馈附实际触发条件、相关文件、预期与实际结果及脱敏证据；不要只转述测试失败。
- 同一时间只有一个实现者写源码。Claude 修复期间 Codex 不并行改同一文件；收到修复交付后核对 diff，再复测对应问题和受影响的回归范围。
- 以真实限额提示或明确停工信息判断额度耗尽；暂时没有输出不等于没额度。额度耗尽后 Codex 可直接接手，不再要求用户选择，也不购买额度。
- 文档与测试记录持续更新，保留已完成结果和运行中的任务状态；已通过且没有新变化影响的检查不反复重跑。
- 普通进度、交接和可自行解决的问题保持安静；完成后汇总结果。只有确实缺少外部权限、设备或必要信息而无法继续时才请用户处理，先完成其他不受影响的工作。
- 本轮负责实现、审查、测试和本地交付；没有新增推送、合并或发布授权。

## 2026-10-19 03:29 JST：首轮审查已交回修复

- Claude 已于 03:05 交付 `719d85a140da37a6cfbc2241af4a562a3aa85697`，源码提交完整，文档保持未提交。
- Codex 在该提交完成隔离 Windows 编译/部署、99/99 CTest 目标（6 个内部用例明确跳过），Android 116 单测、lint 和 APK 校验；五版真实 API 共 90 项、首页四种排序共 60 组通过。完整证据及限制已写入主验收文档，不重复跑无关范围。
- [首轮审查清单](../../verification/2026-10-19-jellyfin-review-719d85a.md) 有两项 P2：JF-01 Jellyfin 设置弹窗缺 apiProvider（真实 Windows＋12.2 已复现），JF-02 旧 Apple TV Jellyfin 会话已有 serverID 但缺 kind 时跳过迁移。
- 03:28:48 JST 对应 UTC 18:28:48 的 Claude 会话日志已记录本轮「Codex 首轮审查，请直接修复后交回」用户消息。通过 Computer Use 发给原会话；发送前输入框为空，未覆盖草稿。UI 显示周额度使用 95%，没有耗尽提示。Claude 是当前源码实现者，Codex 等其明确修复交付后核对 diff 与复测。
- 当前无 Codex 构建或测试进程在跑。五个本轮 Jellyfin 服务保留供复测；准确 PID/路径记录为 `D:/CodexDeps/TigerestTheater/verification/jellyfin-290/servers/running-<版本>.json`，操作前再核对。其他临时服务/目录勿误清理。
- 隔离构建：`D:/CodexDeps/TigerestTheater/verification/jellyfin-290/build-719d85a`。后续可增量重建该目录，但必须记录修复后的源码提交，更新 install 暂存资源后再启动。Android ASCII junction：`C:/A/tigerest-jellyfin-290-android`；JNI 已按锁文件从缓存补齐。
- 下一阶段：复测两修复；继续 Base URL、五版真实 Windows 界面与播放、12.2 Modern/Legacy、字幕/音轨/切服/退出、生产 API 对照及可用设备检查。当前缺 Apple 工具链、ADB 无连接设备，不能写成全部验收通过。自动跟进继续覆盖修复与复测，不停用。

## 2026-10-19 03:55 JST：首轮产品修复通过，测试隔离问题交回

- Claude 03:40 交付 `6873c07`。JF-01/JF-02 代码复核通过；Windows/Android 已重建，目录仍复用 `build-719d85a`，日志以 `6873c07` 标记。
- 真实 Windows＋12.2 Modern 首页稳定显示、设置三库选项及详情通过；从实际播放入口调用 MPV，出画面、暂停、18 秒 seek、stop 已验证。音轨/字幕/完整连续播放、其他布局和版本仍待测；Apple 仅静态核对。
- 八项受影响 CTest 六过两失败：图库动画超时尚待无其他客户端时复测；设置失败根因已定位为 fixture 替换 api 后仍初始化原生注入的社区插件（JF-03）。详细记录在主验收文档及首轮审查清单。
- 03:55:03 JST（UTC 18:55:03）同一 Claude 日志确认收到「Codex 6873c07 复测反馈：请修一个测试隔离问题后交回」。仅请修设置测试隔离并跑该目标/Chrome，不改产品逻辑、不跑全套。发送前空输入框；周额度显示已用 97%，未耗尽。
- 当前 Codex 没有构建/原生测试在运行；上次播放 exec 3272 已退出 0，最初复测 exec 13523 已失败退出 1。等待 Claude 明确交付后再开始原生检查，避免窗口单实例冲突。
- 继续使用本轮五个服务、已有 APK、测试凭据；不重复创建环境。后续重点：JF-03 修复复测、图库独立重试、增加连续播放/音轨/内外字幕证据、Base URL、12.2 Legacy、其他版本与生产 API/设备限制；全部可执行工作完成前不关闭跟进。


## 2026-10-19 04:13 JST：本轮可执行验证完成，交付状态

- 最终产品代码 `6873c07`，最终测试代码 `dffa1bd23df2c5b752e97b94ecc29780c1cb8767`。Claude 03:56 明确交付后，Codex 复核只有一个测试文件变化，产品源码未变。JF-01/JF-02/JF-03 均已修复并复核；JF-02 仍缺 Swift/TV 运行环境。
- 设置与图库 CTest 重试 2/2 通过（18.73 秒）；与此前通过的六项组成该次八项目标回归。没有为本次测试修复重复全套构建。Windows/Android 使用 6873c07 的已校验产物，APK 三个关键共享脚本匹配当前源码。
- 五个真实 Jellyfin 版本根路径和各自 `/jellyfin` 隔离代理均通过 Windows 登录、首页、设置、详情、连续播放、双音轨选择/解码、内外字幕与关闭、暂停/seek/stop、服务器续播记录。12.2 Modern/Legacy 通过，实际设置菜单、退出/切服、自动下一集和离线下载/本地播放/清理通过。音频测试静音，不冒充人工听音。
- 生产 Emby 4.10.0.40 的 LAN/公网入口公开信息接口 200；无生产认证媒体/播放验证。本机无 Apple 工具链，ADB 无设备；这些需外部资源，Windows/fixture 不能替代。完整证据、摘要与边界已写入主验收记录和更新说明。
- 尝试停止并重启独立 12.2 测试服务以配置原生 BaseUrl 时，自动审批以 `blocked by policy` 拒绝整个命令。核对 PID 354544 与配置未变。没有换手段重启；改用临时代理验证客户端子路径，并保留服务器原生配置场景的限制。
- 当前无构建、原生测试或临时代理运行。所有测试 profiles、离线下载已自动清理；五个服务器和复测证据仍保留在 `D:/CodexDeps/TigerestTheater/verification/jellyfin-290`，PID 清单仍为 `servers/running-<版本>.json`，使用前再核对。没有动用户安装版、设置、媒体、Docker/WSL。
- 文档完成本地归档后暂停 heartbeat `jellyfin-2-9-0`，不继续无意义轮询。若后续重新启动协作，先核对本节、最终提交与测试记录；只补缺失的外部环境验证或新改动影响的范围，不重复本轮完成项。没有推送、合并或发布授权。

## 2026-10-19 16:34 JST Android 接入与 Mac 任务导出

- 用户新接入 Android 16 手机 `24072PX77C`；ADB 在线。正式包保留。首次安装独立调试 APK 被手机以 `INSTALL_FAILED_USER_RESTRICTED` 拒绝，调试主包仍未安装。已等待用户解锁、允许 USB 安装后重试；不要把在线状态当成真机播放通过，也不要自行修改安装安全限制。
- 当前产品未改动，复用已校验 `1625adfd311264f5367a3c1fcc066aaaa490e832b35e87348bd1369806ae9928` APK。证据 `android-install-attempt.json`；预备脚本 `android-real-server.cjs` 仅通过语法检查，需在安装成功后执行。主验收记录已补充本轮状态。
- 用户要求 Apple 工作交给 Mac 上的 Codex；导出目录 `D:/CodexDeps/TigerestTheater/verification/jellyfin-290/apple-handoff/`，包含详细中文任务说明与增量代码 bundle。bundle 固定 `c1a301f6ad835c22f27567778e4bda46df109559`，前置 `2f5e06c97bd6c9cd4cdc1f5b4fe84c3813a69857`。Mac 在独立分支实施与验证，通过 bundle/patch 和脱敏报告回传，不推送/合并/发布。Windows 不重复既有完整矩阵。

## 2026-10-19 16:43 JST 真机发现 JF-04 并交 Claude

- 用户确认解锁并允许 USB 安装后，2.9.0 调试 APK 安装成功，版本码 2090000。手机 12.2 登录和首页三卡已显示，但不等于原生播放通过。
- 复现 JF-04：Jellyfin SPA 的 DIV 冒泡 CustomEvent pagehide（isTrusted=false）误触发 Android bridge 的 window pagehide once 监听，桥被永久关闭。iPad bridge 有相同写法。证据 `jf04-android-reproduction.json`，复现脚本 `android-real-server.cjs`，均在本轮证据目录。
- 同一 Claude 会话 07:43 UTC 已收到直接修复请求并开始检查。要求修 Android/iPad 真实文档生命周期判断，忽略 SPA 元素事件且不提前消耗关闭监听，保留真文档关闭时 pending/signals 清理，并增加两端 Node 回归。Codex 不并行改源码；等明确提交后重建 Android、重跑受影响真机链路，再更新 Mac 交接文档和 bundle 的精确 HEAD。

## 2026-10-19 17:00 JST JF-04 已修复，JF-05 交接与新增远程服务

- Claude 16:48 明确交付 `7fc0e43`、`7cdb83e`，Codex 独立 21/21 Node 回归通过，并重建安装 `7cdb83e` APK。Android 真实 12.2 登录后桥接正常、设置三库正常；iPad 实际 WKWebView 待 Mac。完整 SHA256 与证据在主验收记录。
- 真机继续播放暴露 JF-05：`PlaybackController.load` 先投递显示 UI 后立即 loadfile，Surface 尚未 attach，MPV 报 Missing surface pointer，视频轨被关闭而音频仍推进。两次复现的脱敏证据 `jf05-android-reproduction.json` / `jf05-android-surface-log.txt`；同一 Claude 会话 16:57 收到具体修复请求。不要把时间推进当成出画面。等明确交付后核对源码、JVM 回归、重建 APK，再运行真机矩阵；不要在 Claude 修改时改同一源码或启动全套。
- 用户追加允许 `https://tv.xm233.cn/` 测试。实际 10.11.11、测试账号非管理员、认证及媒体库/媒体/详情/PlaybackInfo 均 200；仅完成 API 还未实播。工作树外 `remote-xm233*.private.json` 含私密测试状态，禁止归档到代码或导出包。准备好的 `android-remote-server.cjs` 只通过语法检查，需在修复后执行。
- Mac 交接包已实际交给用户，现已加入远程站点说明并重新验证 zip/manifest；固定代码基线 `7cdb83e2c520a10f3ec960f55a920215c3ae082f`，文件 `D:/CodexDeps/TigerestTheater/verification/jellyfin-290/Jellyfin-2.9.0-Mac-Codex交接包.zip`。后续 Android 专属补丁不要悄悄改变 Mac 已收到的基线；需要时提供增量。


## 2026-10-19 17:26 JST JF-05 真机复测与无线调试接续

- Claude 明确交付 `de48a73b249365b86aa87533bf895c597307dfc0` 后，Codex 复核 `VideoSurfaceGate` 接线与新增 JVM 结果：123 个测试、21 套件、零失败/错误，其中 7 个 surface gate 用例；这项是核查 Claude 本轮生成的 XML，未冒充独立重跑。
- Codex 独立 lintDebug、assembleDebug 成功；APK 89,083,625 字节，SHA256 `ea50147f290dabc13505f2edfc2506aee76522ff1d0bf7d3fe450ce2e8da055f`，20 个原生库 16 KB 对齐校验通过。成功更新本轮专用调试包，保留正式版和用户数据。证据 `android-build-de48a73.log`。
- Android 16 / Xiaomi MIX Fold 4 真实本地 12.2：登录、首页、设置三库、详情、640×360 MediaCodec 出画面及连续进度、暂停、第二音轨、内外 SRT、关字幕、18 秒 seek、停止与服务器续播点均通过。已查看实际 PNG 视频与字幕画面。证据 `android-12.2-root-modern.json`、同前缀图片及 `android-12.2-de48a73.log`。JF-05 首次播放复现解除；快速替换/后台重挂载仍需对应设备场景。
- 用户授权的远程 HTTPS 10.11.11：登录及首页 24 卡、设置 11 项、H.264 852×480 MediaCodec 视频和 FLAC 解码、连续进度、暂停、外挂 ASS 载入选择、关闭字幕、45 秒 seek 后继续、停止清理均通过，原生错误为空。已查看实际媒体画面，测试静音，不冒充人工听音或已目视 ASS 文本。证据 `android-remote-xm233.json`、同前缀图片及 `android-remote-de48a73.log`。另外 Range 请求实际取回 65,536 字节、206/Matroska magic 正常，见 `remote-xm233-stream-api.json`；该 API 证据与设备播放结论分开。
- 10.9.11 登录/首页后手机因电量不足断开，未完成播放；该次记录为连接中断，不计产品失败或通过。其他四版根路径播放、子路径、12.2 Legacy、下一集及退出/切服待续。用户充电后开启无线调试；ADB mDNS 发现并成功连接同一设备，已有配对生效。无需改网络或安全设置。
- Windows 在 de48a73 增量构建和暂存成功，读取 TESTING.md 并同一 PowerShell dot-source 测试环境后，执行受 JF-04 影响的 update/community/settings WebEngine 三目标，3/3 通过，20.52 秒。证据 `windows-jf04-affected-de48a73.log`。既有五版 Windows 全矩阵无需为 Android 专属改动重复。
- 用户反馈首页海报顶部空白，现列 JF-06：真实 10.11.11 隐藏 `.skinHeader` 后，外层 `#indexPage.pageWithAbsoluteTabs.withTabs` 仍保留 111.6px 顶部 padding，再叠加图库自身安全区；12.2 Modern 还需检查原导航与状态栏重叠。已直接交同一 Claude 修复并要求仅首页覆盖、离开及收藏恢复。证据 `jf06-gap-10.11.11.json`/PNG；后续布局探针使用隔离 headless Chrome，先前临时原生窗口已退出。Claude 仍为源码实现者，Codex 只维护文档和外部验证脚本，待明确交付后重建及复测。
- Apple 已发送包的代码基线仍为 `7cdb83e`。JF-06 触及共享首页资源，交付后提供明确增量，不能悄悄改变 Mac 已开始工作的基线。账号密码、令牌和私密媒体身份不进入导出包。


## 2026-10-19 18:07 JST Codex 接手 JF-06 / JF-07，继续设备验证

Claude 日志于 17:36:01 JST 明确提示周额度耗尽。按用户授权，Codex 接手其未提交源码，成为唯一写入者。18:03 额度恢复后，只向同一会话请求只读定位 Modern 导航疑点，明确禁止编辑、构建、浏览器和 ADB；不把恢复额度当成自动交回写入权。

- `490adbd68692d8a699a8f866ecf3a64c96cc9ae9`：保留并复核 Claude 的首页 page marker、隐藏 Modern AppBar/占位块和 Android 安全区方案，补充 Modern 收藏使用路由，避免误点残留的隐藏 Legacy 按钮。Codex 新增实际浏览器布局回归，旧代码在顶部留白断言失败，当前 Legacy/10.x Modern/12.2 Modern 均通过。Chrome 与 Qt 均通过；Qt 新目标 `test_jellyfin_home_layout_webengine` 1/1，5.16 秒。最初测试用 rAF 在遮挡窗口暂停，以及宿主入场动画和夹具 ResizeObserver 未更新导致失败；最后隔离入场动画、用已实测的占位高度描述页壳，不改产品来迁就测试。31/32 Node 用例计数以对应日志区分。图库 Chrome 原有交互/响应式回归、Android 顶栏 Chrome 回归通过。
- 真实五版本页壳：10.9.11/10.10.7/10.11.0/10.11.11 和 12.2 Legacy 的 headless 登录、无顶部导航占位、收藏恢复和详情恢复通过。12.2 Modern 首屏几何通过，收藏→首页→详情的完整链路尚有导航疑点，不写成全通过。证据 `jf06-real-*-review.log` / `jf06-verify-*.json`。
- `490adbd` 产物：Android lint/assemble 成功，APK SHA256 `f593e898359b6af960a345768e0aa817b26a9695d5376fd4f0946eb6d2771c37`，89,083,625 字节、原生库16KB对齐通过；Windows 增量构建/暂存成功。手机12.2 首页 root top=0、图库 padding=53.4286 CSS px，安全区=43.42857 CSS px，只加一次10px内部间距；已目视截图，没有原大块空白。实际播放、双音轨、内外字幕、seek/stop/续播，以及自然结束启动第2集、后台回前台视频继续均通过。`android-12.2-jf06.log` 与对应 JSON/PNG。测试记录 source 当时显示父 HEAD de48a73；这些记录的产品差异实际对应随后提交的490adbd，不据旧字段误认旧APK。
- 新发现 JF-07：完整 Android 资源下收藏→首页后页面已显示，但 `TigerestHomeTransitions.busy` 一直为真；`homeMotion.openLibrary` 在未 attach Emby 导航服务的 Jellyfin 上仍启动 Emby 过场，而同文件 openItem 已有无绑定时直接导航保护。Codex 在 `043d37c5c78e39c7d74b4fad56416df74ac6841b` 给 openLibrary 补同样保护。新增行为用例先失败后通过，46/46 Node、原 Emby motion Chrome14项通过。重建安装后真机 motionBusy=false，收藏可返回首页。
- 仍待定位：12.2 Modern 返回首页后再点海报详情不导航，最小 headless 和完整手机资源均复现。已交 Claude 只读看 appRouter/showItem 契约；Codex继续验证其他版本。该项尚未确认根因或修复，不能宣布整体验收完成。
- 手机无线已连接；两次失败收尾时 ADB 服务连接被重置，已通过同一 mDNS 地址重新连接，没有让用户重复配对或改设置。正式版及用户配置仍保留。Android其余版本根路径与子路径、退出/切服在续跑。Mac 增量包须等当前导航问题处理后提供，原7cdb83e基线包保留。

## 2026-10-19 18:30 JST：JF-08 结束，JF-09 交 Claude 实现

- JF-08 已在 `7656de0031e23122269f075889fcc7b71b0f3f90` 修复：Modern收藏使用hash，避免React复用页时不发viewshow导致旧导航promise阻塞。Node47/47、真实网页/完整Android收藏→首页→详情通过；Windows重建及三个受影响CTest3/3通过（19.13秒）。最终APK及EXE哈希见主验收记录，包内共享资源逐字节匹配。
- Android五版根路径及代理子路径播放已补齐，12.2 Legacy播放、Modern退出与通过原生自建入口切10.9.11均通过。原生Surface、下一集、后台恢复、远程HTTPS结果分别保留各自实际源码和证据，不把历史测试写成在最终HEAD全套重跑。
- 用户指出横屏底部多出空白。JF-09已稳定复现：viewport847高、gallery最终top0却height767，resize后变839；多扣72px恰是webAppearance入场translateY。证据 `android-bottom-landscape-before.json` / `.log`。不要删除安全区或硬编码补72。
- 用户误按Esc中止Computer Use后，又明确允许继续。Codex已在同一Claude会话发送JF-09修复任务：允许其仅修改相关产品和测试，补真实动画/取消/再进入/旋转回归，运行最小Chrome/Node后提交。Codex暂停产品源码编辑和构建，只做文档/证据整理，等待明确交付后复核和手机/Windows受影响验证。当前写入权属于Claude，不能误以为此前只读限制仍生效。
- 原Mac包 `7cdb83e` 保留；新增 `docs/verification/2026-10-19-jellyfin-apple-addendum.md` 已写入JF-06/07/08接收方法与Apple专项，但增量zip尚未导出，需等JF-09修复纳入。原详细Apple任务文档继续有效。

18:33 JST：用户要求Mac立即开跑，已另导出并提供 `Jellyfin-2.9.0-Mac-Codex交接包-7656de0.zip`（124,844字节，SHA256 `5afa71855a9d634718b866b06bde5f83153622c8a46496c3dd5d790e18aa3da4`）。包含更新的详细Apple任务、共享修复补测、最新验收记录和从2f5e06c到7656de0的bundle；引用 `refs/codex-handoff/jellyfin-290-7656de0`，git bundle verify与zip逐文件哈希通过。主文档P0指向此固定引用，原7cdb包未覆盖。已明确JF-09不在该包内、Mac先跑独立任务，后续另交JF-09小增量。文件位于证据根目录 `apple-handoff-7656de0/`，账号密码与token不在包内。

## 2026-10-19 18:49 JST：JF-09 已交付并复测

- Claude明确交付829c5f8后，Codex核对3文件diff、重建Windows/Android并独立验证。Node80/80，Windows受影响CTest3/3（29.74秒），手机横屏839/竖屏940且不依赖手动resize；正常安全区保留。真机竖屏Modern、横屏Modern、横屏Legacy往返与详情均通过。完整哈希、日志、夹具选择器修正和未测边界见主验收记录。
- 本轮产品源码写入结束，只有Codex记录文档。正式安装版未动，调试包已更新；旋转恢复free，ADB本轮forward/reverse清空，测试客户端/代理退出，五个独立服务器及证据保留。
- Mac最新完整材料导出为 `Jellyfin-2.9.0-Mac-Codex交接包-829c5f8.zip`（前置2f5e06c），同时另给 `Jellyfin-2.9.0-Mac-JF09增量-829c5f8.zip`（前置7656de0），引用均固定refs/codex-handoff/jellyfin-290-829c5f8。旧7656/7cdb包不覆盖；接收方式见Mac补充交接。每包MANIFEST记录文件哈希，导出摘要在证据根目录 `mac-jf09-export.json`。
- Windows端可执行的本轮修复和受影响验证完成；Apple由用户转交Mac Codex执行，不能声明五端验收或发布完成。既有heartbeat保持暂停，不启动无新工作轮询。无推送、合并或发布。
