# Jellyfin 2.9.0 手动试用缺陷与 Emby 交互补齐计划

> **For agentic workers:** 使用既有原型、`2026-10-10-home-poster-motion.md` 和本计划逐项实施。Claude 是当前产品源码写入者；Codex 维护证据、文档及交付后的独立验证。用户已授权双方直接交接，不重复要求用户转述或批准既定兼容修复。

**Goal:** 修复用户手动试用发现的登录、键盘、详情布局、动画与返回路径问题，使 Jellyfin 遵循已经实现的 Emby 交互。

**Architecture:** 复用 HomeMotion / HomeTransitions 的动画与上下文规则，显式适配 Jellyfin 的路由、页面生命周期和实际 DOM；保留 Emby 适配与行为。Jellyfin 的 Modern React 路由不能被当成 Legacy viewshow 队列。Android 键盘问题先依据焦点、生命周期与 IME 事件确认根因。

**Tech Stack:** JavaScript、Jellyfin NativeShell / React / Legacy 路由、WAAPI、QtWebEngine、Android WebView / IME。

**Spec:** 用户 2026-10-19 本聊天的手动试用反馈；既有 [Emby 海报转场计划](2026-10-10-home-poster-motion.md)。本轮为兼容补齐，不另行变更既有动画设计。

## 全局约束

- 正确工作树 `.claude/worktrees/jellyfin-290`，分支 `claude/jellyfin-2.9.0`；交接起点 f6f8743（产品829c5f8）。不修改父目录旧分支。
- 用户明确要求：媒体详情返回至对应媒体夹海报墙，不能直接回首页；媒体夹随后返回首页。嵌套单集按既有 Emby 父详情链路返回，不能丢失顶层媒体夹上下文或形成历史循环。
- 沿用现有720ms海报飞行、背景模糊交接、媒体夹退场/入场、首页回场；不得以禁用动画宣称兼容。
- 真实点击、触屏及Android系统返回行为一致；尊重减少动态效果。退出、切服、慢图、路由失败、旋转/折叠都必须清理遮罩和旧上下文。
- Windows原生测试每次读取TESTING.md并在同一PowerShell dot-source环境；隔离profiles，保留用户当前试用的认证/地址，正式客户端与媒体不动。
- 实现期间不并行修改同一源码；Claude只跑最小Chrome/Node自检，明确交付后由Codex重建Windows/Android及真机复测。
- 远程站点私密凭据在证据目录外部private文件读取，禁止写进源码、文档、日志输出和Mac交接包。
- 不推送、不合并、不发布。共享修复另给Mac增量及验收要求，不能冒充Apple验证完成。

## 已确认与待确认

### JF-10 登录后停在登录页（80e995e 已修复，原生包待验证）

Windows真实试用停留登录页后输入账号，认证和socket成功，页面仍在登录框，日志反复报`Cannot set properties of undefined (setting htmlFor)`。
`homeTransitions.frozen/copyTree`创建普通输入框又复制`is=emby-input`，Jellyfin v0 CustomElements polyfill会升级快照节点；复制的emby-input class导致createdCallback不建label，attachedCallback异常。
独立远程Chrome探针对照：原代码errors3、authenticated=true但gallery=false；不加载motion脚本或仅在探针内跳过is属性，两组errors0/gallery=true。探针没有改产品源码。
证据根目录 `D:/CodexDeps/TigerestTheater/verification/jellyfin-290/jf10/`：`login-probe.cjs`、`login-motion.json`、`login-plain.json`、`login-no-is.json`。10:23:56UTC原Claude会话收到修复描述。

### JF-11 Android地址栏键盘（已复现 WebView 窗口失焦问题，原生输入替代待实现）

不是单纯漏输冒号。用户确认切换英文/符号时键盘会自动收起或跳回原布局。实际input为type=text、inputmode=url；不能未验证就认为改inputmode可修复。须观察focusin/out、resize、Activity重建与IME启停。
测试收尾遗留的127.0.0.1地址已经通过真实连接表单改为用户提供的远程HTTPS站点；手机已进入详情。裸域名目前会默认补http，提示应准确说明实际行为，不能承诺默认https。

### JF-12 详情布局（真机已取证）

当前MIX Fold4展开竖屏847×948 CSS px，真实远程10.11.11单集详情：skinHeader高148.46、padding-top43.43；headerTop额外上下padding29.76；固定缩略图top142.17，已进入header遮挡区域。正文detailPageContent左padding274.93，视觉呈现明显左右割裂。
页面实际为`#itemDetailPage.itemDetailPage`，现有Emby紧凑详情CSS使用`.view-item-item`，未覆盖相同Jellyfin结构。截图`phone-current.png`和几何`detail-before.json`，只作为诊断证据，不放私密媒体图进公开文档。

### JF-13 动画与返回上下文（源码和真机均确认缺失）

Jellyfin插件只创建首页，未attach HomeMotion；`openItem/openLibrary`在无bindings时直接navigate。实际详情`motion.entry=false`、`transitions.last=null`。此前JF-07的fallback避免卡死，但不能当作动画完整支持。
既有Emby实现已包含homeOwned、libraryPath、parent、account及后退replace语义；Jellyfin需要等价适配，不能硬套pageJs或伪造viewshow解除promise。

## 审查重点

1. 慢速手动输入/停留登录页，快照不会升级控件、抢焦点或泄露输入值。
2. 媒体夹/收藏、搜索/深链接、首页直达详情、连续单集嵌套的返回目标与历史一致；找不到海报时降级但不丢导航。
3. Modern同页切tab与Legacy页面切换事件不同；不恢复JF-08已修复的promiseShow死锁。
4. 折叠/展开、横竖屏、IME显示期间不裁切按钮或重建输入连接；正常安全区保留。
5. Emby真实DOM/原转场不能因Jellyfin选择器或CSS全局覆盖退化。

## 实施任务

- [x] JF-10：为v0 polyfill与原生customized built-ins增加静态快照行为回归；80e995e修复复制节点升级，Chrome独立验证输入状态、样式、重新进页和真实远程延迟登录。Windows Qt / Android 新包仍在下方交付后验收任务中。
- [ ] JF-11：在同一手机真实软键盘复现英文/符号切换，记录焦点/页面/Activity/IME事件。定位后做最小修复；验证冒号、斜杠、数字端口、切换输入法/符号、旋转及返回不掉输入。地址帮助文案与normalizeServer一致。
- [ ] JF-12：基于Jellyfin真实电影/剧集/季/单集DOM补作用域明确的布局适配，检查390/600/847/948/1280宽度，标题/海报/元数据/播放按钮/简介/剧集列表无重叠裁切，导航与安全区只计算一次。
- [ ] JF-13：增加Jellyfin导航适配层或明确策略接口，复用现有motion。为首页→媒体夹→详情、首页→详情→媒体夹→首页、剧集→季/单集→父详情、收藏往返、原生返回建立先失败的行为测试。
- [ ] JF-13：真实可见节点的海报飞行与落点、背景模糊、媒体夹退场/入场、单集进入/返回逐条验证；不能仅凭函数存在或路由改变通过。
- [ ] 实现者最小Chrome/Node回归、Emby受影响测试，明确提交并交回Codex。
- [ ] Codex核对提交/diff/未跟踪文件，重建隔离Windows与Android；Qt受影响目标、真实远程登录、可用手机全部交互路线/键盘与布局实测。
- [ ] 文档逐项记录实际结果/未验证边界，更新用户可试用实例；导出共享修复Mac增量及对应Apple任务，不改已发送基线包。

## 当前状态

尚未完成本轮交互验收。此前API/播放矩阵继续按各自固定源码成立，但不能代表上述手动输入、详情布局、动画和返回路径已经通过。截图和用户新反馈优先于此前笼统的完成措辞。

## 追加：JF-14 服务器选择/登录公共页面头部遮挡

用户继续手动测试发现服务器选择页标题被空导航条遮挡。实时DOM确认远程10.11.11：847×948视口中 `.skinHeader` fixed 高104.46，其中safe-top43.43，空 `.headerTop` 仍有上下padding29.76；`#selectServerPage.standalonePage` padding-top仅66.96，h2从66.96开始，被header覆盖至104.46。非媒体详情专属问题。

- [ ] 检查选择服务器、添加服务器、登录、用户选择等standalone页面；无操作的空header不应保留实体遮挡条，有操作的header与页面顶部偏移需统一。
- [ ] 复测紧凑/展开/横屏、IME打开与关闭、系统safe area，标题和首个控件必须在可视区域且不被fixed header覆盖。
- [ ] 使用页面/服务类型作用域，避免一刀切隐藏所有导航；保留用户返回/切服入口。

## 追加：JF-15 Windows / Android 统一切服入口

用户明确要求可从当前Jellyfin回到最初的“大河专属 Emby / 自建 Emby或Jellyfin”客户端选择界面；Windows和Android均需提供。

设计：复用已有统一选择页，在未登录的选择服务器/登录页及已登录后的客户端设置中提供清楚的“切换服务器”入口。Jellyfin自带selectserver只管理它的服务器列表，不能代替客户端入口。当前nativeshell的“重置已保存的服务器地址”深藏在主设置且清空saved/mode，不适合当常规切换方式。

- [ ] 增加明确的主动选择页进入语义（不自动重连旧服务器）；普通启动仍按用户保存的选择工作。
- [ ] 保留已有服务器地址、各服务器登录存储和播放器设置；单纯打开选择页不清除地址/登录，不把切服做成重置。
- [ ] 统一入口在登录前/后可达，窄屏收进有明确标签的菜单亦可；不能被空header或登录表单遮挡。
- [ ] 从Jellyfin→客户端选择→大河专属Emby、Emby→选择→自建Jellyfin来回测试；返回键/取消可回原页，不自动重连陷入死循环；失败可重新选择。
- [ ] 共享资源变更同步Apple交接说明，Apple真实验证仍由Mac承担。

### JF-15 交付后的验收路径

| 起点 | 操作 | 必须验证 |
| --- | --- | --- |
| Jellyfin 登录页 / 服务器选择页 | 点击客户端“切换服务器” | 到“大河专属 Emby / 自建 Emby 或 Jellyfin”选择页；不被原站点自动重连带走 |
| Jellyfin 已登录首页 / 详情页 | 设置内切换服务器 | 同一入口可达；没有清空服务器地址、账号存储或播放器设置 |
| 统一选择页 | 取消 / Android 返回键 | 返回原客户端页面；不陷入选择页与旧服务器之间的循环 |
| 统一选择页 | 选择大河专属 Emby，再回选自建 Jellyfin | 两个方向都可访问；各服务器会话和当前服务器识别正确，不跨服务器复用凭据或媒体上下文 |
| 自建地址输入 | 编辑后取消；输入无效或离线地址 | 取消保留原地址；连接失败可重试或返回选择；错误提示不盖住按钮 |
| 正常冷启动 | 从已保存配置启动 | 维持用户原先的自动连接行为；只有主动切服才强制显示选择页 |

上述每条在Windows隔离profile与Android调试包分别记录，不能由函数调用成功或单个URL变化替代实际页面与返回键检查。生产Emby没有认证媒体测试条件时，只确认客户端入口与公开连接，不将其写成已完成生产账户或播放验证。

### JF-11 追加实测

MIX Fold4当前WebView155.0.8059.43、Chrome155.0.8059.39、Gboard。在现有WebView加入不保存设置的临时input(type=text,inputmode=url)探针：点?123能保持键盘，但拼音符号页输出的是全角冒号；长按空格切语言时软键盘消失，DOM activeElement始终是原input，没有focusout/pagehide/Activity重建。原生日志出现Chromium ImeAdapterImpl调用hideSoftInputFromWindow和HIDE_SAME_WINDOW_FOCUSED_WITHOUT_EDITOR。暂停HomeTransitions/prewarm后仍复现；type=url仍复现，故不能把它归因于motion快照或靠更换inputmode宣称修复。临时input已移除，原829版本motion脚本已恢复，保存地址和登录数据未改。

官方检索有同类标题：[Chromium 570135727](https://issues.chromium.org/issues/570135727)（Android Gboard语言选择菜单在网页input中立即消失，Chrome154）。正文需登录，不能据此宣称本机已确认同一根因或已修复。空白Chrome对照启动被自动审批拦截，仅返回blocked by policy，未执行；不改系统WebView版本/键盘设置。证据jf10/ime-switch.json、ime-last-state.json及ime-switch-*.png，仍需进一步定位或经验证的客户端输入替代路径。

### JF-11 根因补充：已取得版本源码对照

在当前WebView中增加独立srcdoc iframe（没有播放器注入脚本，父页/设置保留）也复现：长按空格后外层activeElement仍是iframe，内部activeElement仍是probe，仅IME消失；子页面focusin后没有focusout。测试iframe已移除，不另启动Chrome/服务。

官方Chromium155.0.8059.43源码 `ImeAdapterImpl.onWindowFocusChanged` 无条件在 `!gainFocus` 时 `resetAndHideKeyboard()`。与本机日志的ImeAdapterImpl主动hideSoftInputFromWindow一致。当前主线该处已改为reset，不因窗口短暂失焦收起键盘，注释明确关联560321831语言切换弹窗问题。[155源码](https://raw.githubusercontent.com/chromium/chromium/155.0.8059.43/content/public/android/java/src/org/chromium/content/browser/input/ImeAdapterImpl.java)、[当前主线](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/public/android/java/src/org/chromium/content/browser/input/ImeAdapterImpl.java)。本机源码对应文件已留jf10目录。570135727公开检索返回的第6条评论另提到同类修复在Chrome158.0.8106.0；不能把Chrome版本当作手机WebView已升级。

建议JF11按地址编辑实际需求做局部Android原生EditText能力，文本返回后仍由统一normalizeServer及连通性校验处理；Windows/Apple不盲目套用。原生EditText成为IME编辑目标后，不受WebView输入连接失焦逻辑影响（hideKeyboard只对当前active WebView生效），仍须实际验证。不要改全局WebView onWindowFocusChanged、强制反复弹键盘或修改手机系统WebView版本。取消不清空、选择/光标/旋转保持、符号和语言切换为必要验收。

### JF-10 独立复测记录

80e995e已明确交付。从git archive固定native/tests/settings快照在外部source-80e995e验证，未对Claude正在进行的交互修改发起构建：新增polyfill三个Chrome场景（快照/延迟登录/再入登录）通过；原静态缓存回归通过，原生customized built-in副本构造/连接为0且几何/表单/滚动保留；真实远程Jellyfin10.11.11登录探针在输入前后分别停留4.5秒/3秒后提交，authenticated=true、gallery=true、errors=[]。证据jf10/login-verified-80e995e.json。Windows Qt/Android新包尚未验证。
