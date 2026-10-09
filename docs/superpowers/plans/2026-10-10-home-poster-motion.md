# 首页排序、交互与海报转场接入计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户已确认的独立转场原型接入三端共享首页和实际 Emby 路由，交付可试用的隔离 Windows 与 Android 构建。

**Architecture:** 首页数据、移动点按及查看更多继续由共享 Gallery 管理；新增独立 HomeMotion 管理路由上下文、冻结背景副本及海报飞行。Emby 仍负责实际页面和数据，原首页 enter/animateText 的关键帧不改。设置沿用原生 settings_description 与两端设置存储。

**Tech Stack:** 共享 JavaScript、Emby 原路由、WAAPI/Canvas/Shadow DOM、QtWebEngine、Android WebView。

**Spec:** 用户本次对原型的实装授权；`C:/Users/59890/Documents/ChatGPT/EMBY大河版/output/playwright/home-motion-2026-10-10/README.md` 与最终 `preview.js`。最终产品行为以本文件约束和会话确认规则为准。

## Global Constraints

- 默认继续观看；不足 24 项用当前媒体夹近期入库补齐，按作品去重；另支持近期入库、发行时间、评分。
- 首页作品详情的返回目标是其媒体夹（收藏进入收藏）；媒体夹随后返回首页，避免详情历史循环。
- Touch 首次选择、再次进入；不显示“再点进入”文字；轮播上方右侧加入“查看更多”。鼠标及键盘保留原行为。
- 海报来自首页底部竖版封面；720ms 移动至实际详情海报。背景先模糊，最模糊时交接，再连续清晰。重模糊背景降分辨率。
- 首页进入媒体夹保持蓄力、加速飞出、中央放大淡入；返回复用原首页入场。原导航/轮播/文字动画关键帧保持。
- 尊重减少动态效果；路由错误、目标缺失、图片慢、账户切换及窗口变化都必须清理浮层并恢复输入。
- Windows 原生测试前读取 TESTING.md，且在同一 PowerShell 调用 dot-source Enter-TestEnvironment.ps1。所有 UI 检查使用隔离配置。
- 不覆盖已安装的正式客户端。Android 安装独立 debug 包；交付前恢复其真实服务器地址。macOS 仅验证共享打包入口，不能宣称实测。

## Review Focus

- 同一剧集的多个继续观看单集：仅一张作品卡，保留最近播放记录；补齐不能跨媒体夹。
- 慢网络或缺失图片/海报：不能留下遮罩、禁用页面或错误返回目标。
- 收藏、服务器/用户切换及注销：不能沿用前一个身份的路由上下文和排序缓存。
- 反复详情→媒体夹→首页：返回应无详情循环，初始开屏和返回入场都应保留原节奏。
- 外部样式表、虚拟海报墙和窗口变化：不读取受 CORS 限制的 CSSOM，不假定所有作品卡已在 DOM，不保留旧几何浮层。

### Task 1: 首页数据排序及设置

**Files:** `native/homeData.js`, `native/homeGallery.js`, `native/nativeshell.js`, `native/embycompat.js`, `resources/settings/settings_description.json`, `android/app/src/main/java/top/tigerest/theater/SettingsStore.kt`; tests `tests/test_home_data.js`, `tests/test_native_settings_registration.js`。

**Interfaces:** `HomeData.load(library, signal, order='resume') -> Card[]`；card 保留 `item`, `addedAt`, `latestEpisode`，另携带继续观看记录。`settings.home.displayOrder` 为 `resume|recent|release|rating`。

- [ ] 增加默认继续观看、补齐、跨夹隔离、重复剧集、分页、取消、缺失播放记录降级及其余三种排序测试，并观察新测试失败。
- [ ] 实现共享数据查询和 work 去重，接入两个原生设置存储及菜单；原近期入库测试显式使用 recent。
- [ ] 运行 `node --test tests/test_home_data.js tests/test_home_registration.js tests/test_native_settings_registration.js`；全部通过。
- [ ] 保存实现和验证记录；提交该任务相关文件。

### Task 2: Gallery 点按与实际路由上下文

**Files:** `native/homeGallery.js`, new `native/homeMotion.js`, `native/sessionNavigationPlugin.js`, `native/embycompat.js`; tests `tests/test_home_motion.js`, `tests/test_home_gallery_ui.cjs`。

**Interfaces:** `TigerestHomeMotion.attach({router, pageJs, manager, viewManager})`；`openItem({gallery,card,library,source,navigate})`、`openLibrary({gallery,library,navigate})`；Gallery 在无 motion 时保持可独立运行。

- [ ] 新增 touch 两次点按、查看更多跟随当前媒体夹、实际路由上下文、详情返回 replace 当前条目而非重复 push、注销清理的测试；观察失败。
- [ ] 接入触屏选择状态和上下文，保留原 Emby 数据与路由；收藏回原收藏控制器。
- [ ] 运行 Node 路由测试及可见浏览器 Gallery 测试；验证原入场时序和生命周期仍通过。
- [ ] 保存验证记录；提交该任务相关文件。

### Task 3: 转场与跨端注入

**Files:** `native/homeMotion.js`, `native/webAppearance.js`, `src/system/SystemComponent.cpp`, `android/app/src/main/java/top/tigerest/theater/WebHost.kt`; tests new `tests/test_home_motion_ui.cjs`, `tests/CMakeLists.txt`。

**Interfaces:** Motion 持有唯一活动任务，暴露只读 busy 状态；原 Appearance 的普通 page-enter 在该任务期间让出控制。冻结副本隔离 ID 与输入，所有任务 finally 释放资源。

- [ ] 编写实际页面形状的集成夹具，检查背景遮盖、目标落位、加载等待/失败、海报缺失、resize、减少动态效果及资源释放；观察失败。
- [ ] 从批准的原型提取连续模糊包络和 720ms 飞行，适配真实页面和跨域 stylesheet；将源页面快照保留到目标准备好。
- [ ] 接入 home→媒体夹飞出及中央淡入，返回 home 交由原 Gallery enter。更新 Windows/macOS 与 Android 注入列表。
- [ ] 运行 UI 夹具、资源注册、共享 Node 测试；全部通过。
- [ ] 保存验证记录；提交该任务相关文件。

### Task 4: 构建、真实页面试用和交付

**Files:** verification record `docs/verification/2026-10-10-home-motion.md`; preview artifacts in ignored `artifacts/home-motion-integrated-2026-10-10/`。

- [ ] 使用已验证外部依赖在新工作树构建、部署 Windows 暂存包；构建 Android debug APK、受影响单元测试和 lint。
- [ ] 同一 PowerShell 设置测试环境后运行相关 CTest 与 Windows 窗口/全屏 UI；Android 独立 debug 包验证触屏和共享转场。
- [ ] 用隔离已登录预览配置验证真实作品、媒体夹与收藏路线；记录实际网络验证与夹具结果的边界。恢复 Android 真实服务器地址。
- [ ] 按 executing-plans 要求进行一次独立最终代码审查，修复重要问题并复验受影响测试。
- [ ] 交付可点击启动器、Windows 隔离预览及 APK，并如实记录未验证的 macOS 与实际播放范围。

## Execution ledger

- 基线：`codex/release-2.5.1` 的 `577b02c`，新工作树 `C:/A/tigerest-home-motion`，分支 `codex/home-poster-motion`；Node 首页/设置基线 24/24 通过。
- 用户已明确授权实装试用；本计划记录具体实现步骤并连续执行，不重复申请方案确认。
- Task 1: 完成。新排序/设置测试最初 8 项失败；实现后与现有首页/设置测试共 34/34 通过。续看按 work 去重，收藏剧集按父作品资格过滤，缺少续看服务退到近期入库。原近期入库测试明确指定 recent 模式。
- Task 2: 完成。真实路由上下文/硬件返回测试 8 项，触屏 Gallery 交互 8 项及原 Gallery 多尺寸回归通过。触屏测试先在旧代码复现首击直接跳转，再验证两次点按；原 enter/animateText 保持不变。
- Task 3 细化：导航上下文留在 homeMotion.js；截图与动画渲染隔离到 homeTransitions.js，便于独立验证失败清理，不改变既定交互与时序。
- Task 3: Chromium 集成夹具 10 项通过：异步真实路由等待、CSS 背景海报落位、媒体夹返回、错误/resize 释放、缺图降级及减少动态效果；共享 Node 44/44 通过。窗口与 Android 构建进行中，将补充各自引擎验证。
- Final review: 3 项 Important 均复现并修复：取消期间的旧导航/账户上下文、同页收藏缺少入场、收藏返回追加历史。新增 3 项 Node 用例和 2 项 UI 用例先失败，修复后 Node 46/46、Chromium UI 12 项通过；无遗留 Minor。
- 真实 Emby 适配：隐藏的侧海报、虚拟列表无 data-id、合并版本 ID 与首页不同、响应布局延迟均已复现；对应 UI 回归先失败再修复。详情主海报、真实列表 API、PresentationUniqueKey 和飞行末段落点重读完成适配。
- 最新用户调整：当前聚焦作品/媒体夹触屏首击直接进入，切换项才先选择。3 个新增组件断言先失败后通过，Android 真实 touch 首击/双击验证通过。
- PC 返回重影：真实旧页面和半透明缩小副本同时可见，遮底用例先失败；修复 homeReturn/library 退场层后真实 PC 中间帧确认背景不透明。原 Gallery enter/animateText 关键帧未改。
- Task 4: Windows 构建部署、8/8 CTest、11 项 QtWebEngine 触屏夹具；Android 111 项单元测试、lint、APK 对齐及转场/触屏夹具通过。真实服务器 Windows 窗口/全屏与 Android 完整路线通过，390px/760px 详情布局无溢出。证据与范围见 docs/verification/2026-10-10-home-motion.md。
- 最新用户授权扩展：将 0.2～0.3s 点击前背景准备移到预热缓存，媒体夹直达详情也应用同一海报动画。新增 homeBackdrop.js 异步缩图/后台合成，以及当前页单份 DOM/位图缓存；Android 非 origin-clean 应用内图使用已缩小图的主线程兼容路径。
- 缓存回归：13 场景，含内容/resize/身份失效、短入场动画完成、慢解码首段响应、跨域图和 CSS 海报源遮盖；当前聚焦海报不重建背景、无变化的 class 写入不丢缓存。相关断言均先失败后修复。
- 缓存独立审查：两项 Important 已复现并修复；allSettled 关闭并发迟到位图，预热等待短 WAAPI 完成并支持取消/超时。共享 Node 47/47、Windows CTest 9/9、Android 111 单测/lint/构建及实际触屏/硬件返回通过。包及测量更新见 verification 文档。
