# Jellyfin 2.9.0：Mac / Apple 动画专项补充

日期：2026-10-19。给正在并行验收的 Mac Codex。用户新反馈：Apple 侧也可能有动画不生效；Android 的 Jellyfin 动画已经出现，但明显比同机 Emby 卡。Windows 正在补测，不能推定它同样卡，也不能据静态截图判定流畅。

## 先核对代码基线

你已收到的完整历史包为 `6736b4b`，其中产品基线为 `829c5f8`。这份包尚不包含本轮完整的 Jellyfin 动画适配。Windows 当前 HEAD 为 `80e995e2155858f9ef6dc0d1351cdd4798389d06`，其后 JF-11～JF-16 修复仍在工作区审查、构建和实测，**尚未交付最终增量 SHA**。不要把下面描述的实现误当成旧包已有代码，也不要只运行旧包后报告“修复失败”。

Claude 限额后，Windows Codex 已接管共享源码写入。此前追加说明中“Claude 仍为唯一写入者”已经失效。Mac 继续 Apple 独立构建、诊断和平台适配；共享 `native/` 文件若有问题，请回传最小复现和 patch 建议，避免双方独立改同一实现。最终会另交从 `6736b4b` 起的验证过的增量包。

## A. 动画没有生效：JF-13

已确认的共享缺口：Jellyfin 插件原先仅创建首页，没有把其路由器接到 `TigerestHomeMotion`；不能直接复用 Emby 的 page.js / view manager。Windows 工作区已加入 Jellyfin 适配层，当前涉及：

- `native/jellyfinPlugin.js`：连接 Jellyfin appRouter、ServerConnections、当前页面与媒体夹路由；分别处理 Modern / Legacy 的收藏 tab；兼容没有 viewshow 或路由 Promise 不结束的情况。
- `native/homeMotion.js`：识别 Jellyfin 详情与 CSS 背景海报，保留所属媒体夹及父详情，选择真实可见的落点。
- `native/homeTransitions.js`：共用转场和静态快照。`80e995e` 已防止快照的 `is` 属性被 Jellyfin v0 polyfill 再升级；后续性能工作仍在验证。
- 新增 Jellyfin 真实 DOM / CSS 布局和海报落点测试。Chrome / Qt fixture 通过动画落点，不等于 Apple 真机已通过。

### Mac 收到最终增量后逐条验收

| 路径 | 预期 |
| --- | --- |
| 首页→媒体夹海报墙 | 导航/卡片退场和媒体夹入场实际可见，结束后能点击和滚动 |
| 首页直接点电影/剧集→返回 | 海报进入详情；返回到所属媒体夹海报墙，再返回首页，不能直接跳首页 |
| 媒体夹→详情→返回 | 飞行海报落在当前可见卡片，不飞向隐藏 tab 的同 ID 节点；保留海报墙位置 |
| 剧集→季→单集→连续返回 | 单集→季→剧集→原媒体夹，不能丢失父链；分别点海报、标题、键盘确认 |
| 首页→收藏→详情→返回 | Modern / Legacy 均回收藏，再回首页；无重复首页或返回循环 |
| 搜索/深链接直达详情 | 没有可用海报时平滑降级；不能卡住导航，也不能伪造所属媒体夹 |
| 窗口缩放、旋转、快速连续返回 | 转场可取消/收尾；无永久 input 层、遮罩、隐藏真海报或不可点击页面 |

分别验证 macOS Qt 客户端和 iPad WKWebView。若 tvOS 使用原生 SwiftUI 页面，不应假定这些 JS 文件控制其动画；应单独记录对应原生页面的导航/动画行为。记录系统“减少动态效果”状态；启用该选项时降级动画是预期，不要关闭用户设置后忘记恢复。

### 定位“无动画”的最小证据

记录平台、应用包来源和源码 SHA、服务版本、Modern/Legacy、窗口尺寸与复现路线。检查 `TigerestHomeMotion` / `TigerestHomeTransitions` 是否存在、Jellyfin 插件是否注册、`motion.entry` 是否建立、`transitions.last` 是否更新。注意：函数存在或 URL 改变仅证明代码/导航，不证明动画可见。需观察真实海报飞行、背景交接和返回落点；保存脱敏短录屏或 fixture 画面。

检查注入顺序、WKWebView 的 document-start 脚本、路由事件和原生返回桥接，避免用触发假的 viewshow 来掩盖未结束的路由 Promise。

## B. 动画出现但卡：JF-16（新项，尚未修复验收）

Android 同机真实远程 Jellyfin 10.11.11 的初次媒体夹进入已测到超过 100 ms、一次约 356 ms 的长任务；重复进入会变轻。不能只测热缓存。另一组冷进入记录约 135 ms 长任务、帧间隔 P95 约 33 ms；这不是 Apple 测量结果。

目前已找到需要分别验证的机制，不能把候选原因写成最终结论：

1. Android 页头观察器对任何内容插入都重新布局，媒体墙更新也会触发；切服入口观察器还会反复全页扫描。CPU 采样已显示这些调用耗时，正在缩小观察范围。
2. Jellyfin 非虚拟媒体墙、隐藏 tab / 原首页 sections 增大静态快照；v0 custom-elements polyfill 又扫描插入/删除的 shadow DOM。正在检查隐藏分支与离屏卡片复制成本。
3. Modern 收藏同页切换没有 viewshow，Gallery 仍靠 400 ms 轮询，可能额外停顿。共享路由状态更新将单独修正和回归。

Apple 侧不要盲搬 Android IME 或 Android 页头补丁。WKWebView 的快照/模糊路径与 Chromium 不同：保留现有 WebKit 分支，验证原生玻璃模糊及快照外观，不为消除卡顿直接关闭动画或改变设计。

### 性能记录要求

- 同一设备/窗口分别跑 Emby 与 Jellyfin；媒体规模不同需注明。首页→媒体夹、海报→详情、单集往返、媒体夹→首页、收藏分别记录。
- 每条至少包含首次进入和重复进入；区分网络/API 等待与动画飞行期间的掉帧。
- 可读取 `TigerestHomeTransitions.last` 的 `totalMs`、`firstAnimationMs`、`posterFirstMotionMs`、`posterFlightStartsMs`、`medianIntervalMs`、`p95IntervalMs`、`domCopies`、`cacheHit`、`lightCacheHit`、`landingErrorPx`。不要只看平均 FPS 或完成总耗时。
- 用 Safari Instruments/Web Inspector 或 Qt 对应工具采样长任务、样式重算、布局、快照复制及 polyfill 遍历。录屏只能辅助，不能代替耗时证据。
- 页面最终没有残留 `.tigerest-motion-input` / `.tigerest-motion-layer`，无透明但挡住操作的元素。保留 Emby 原有动画回归。

## C. 与 Apple 同步的切服/布局注意事项

Qt 网页从远程 HTTP 页面直接跳 file:// 选择页会被拦截；Windows 已增加固定目的地的 `SystemComponent.openServerSettings()` + QML 信号，需同步 macOS Qt 构建。不要降低浏览器本地文件安全限制。

成功选择新服务器后，原生历史需要清除旧服务器页面；单纯打开选择页/取消则保留原页和登录。Windows/Android 正在加入 `finishServerSelection` 配合原生历史收尾。iPad 现有 `openServerSettings` 要核对同样语义，不能仅因方法同名就假定一致。Apple 尚未实现/验证的能力请明确记录。

动态设置/下载按钮会改变导航高度。JF-14 现在同时检查“真正无操作的空导航可隐藏”和“有操作时内容必须下移”；禁止隐藏有用按钮以通过空导航断言。尺寸变化应及时重测，不能等轮询造成一帧遮挡。

## 回传格式

请回传：确切源码 SHA 与包哈希、macOS/iPadOS/tvOS/设备、Jellyfin 版本与布局、每条路径 PASS/FAIL/未测、关键性能数据、可复现问题、Apple 专属 patch 和构建命令。不上传服务器密码/token、私密媒体列表或用户配置。不推送、合并或发布。

本文件是追加诊断与验收要求，**不是代码增量包，也不是全平台完成报告**。
