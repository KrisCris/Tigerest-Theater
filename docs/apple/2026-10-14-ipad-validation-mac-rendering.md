# iPad 补充验证与 Mac 界面渲染对照

日期：2026-10-14。范围：PR #6 的弹幕匹配补丁、Linux CI 失败调查，以及 Mac 界面渲染方案的可行性实验。没有迁移 Mac 生产架构，也没有合并 PR。

## iPad 与弹幕匹配

- Xcode 27.2 beta 工具链完整构建 iPad App 成功，最低系统仍为 26.0，签名验证通过；正常构建已覆盖安装到 M5 iPad 并无诊断参数启动。此次启动验证不等同于重新验收真实服务器播放。
- AppleCore 的 44 项测试通过，包含标题评分、权威别名、季数/歧义限制、每个提供方最多读取 5 个弱标题候选详情，以及同分候选顺序。
- 复核 `0930ae1` 时发现 Lua 的非稳定排序可能改变同分候选顺序，新增上限后会让 PC 与 Swift 检查不同的前 5 项。`ea5b352` 保留服务端搜索原顺序，并新增“8 个同分候选、只有第 2 个详情具有正确别名”的回归。
- Lua 回归修复前失败、修复后通过；另有 3 项相关运行时夹具与 13 项既有匹配样例通过。该验证加载实际 Lua 实现，但 JSON 边界使用内存替身，不等同于真实弹幕服务请求或视频播放。

## Linux CI 失败原因

原运行 `38457258928` 有 13/44 项失败。通知中的 “All jobs have failed” 指唯一的工作任务失败，并非每个测试都失败。

第一批修复补齐 QML 运行时模块，以 Xvfb 提供显示环境，并修正浏览器测试启动器对信号退出的识别，避免已经崩溃的子进程被误判为仍在运行。运行 `38463602497` 随后达到 42/45 项通过，余下三项已暴露具体错误：

1. 窗口启动测试向 `Tigerest Theater.conf` 写入设置，而 Linux 实际读取 `tigerest-theater.conf`。夹具现按平台使用应用真实配置路径。
2. 安全存储测试假定所有桌面平台都能持久保存凭据。既有 Linux/FreeBSD 实现与文档约定是不提供此后端、会话仅保留在内存。测试现验证真实桥报告不可用、会话不持久化且切换账号清空；支持的平台继续验证写入、读取、删除。
3. 报错页面夹具使用旧版 Chromium 不支持的静态 `Response.json`，请求替身自身抛错后表现为界面等待超时。改用兼容的 `new Response(JSON.stringify(...))`，保留原有业务断言。

这些修复没有更改生产凭据存储策略，也没有跳过失败测试。Linux 全套最终结果以本 PR 对应提交的 GitHub Actions 检查为准；Mac 的夹具验证不能代替 Linux 实际运行。

## Mac 对照方法

在同一台 M4 Pro / 48 GB / macOS 27.2 上，分别运行已安装 Qt 6.9.3 客户端的隔离配置与临时原生 WKWebView 窗口。每端均加载同一可见 iframe：1280×720、DPR 2、相同脚本/样式/数据，无生产服务器和账号。显示器模式为 120 Hz；实际空闲 rAF 回调约每 17 ms 一次。

内容来自 `tests/bench_home_motion.cjs` 与 `0930ae1` 的转场源码：4500 条合成 CSS 规则、240 张媒体库卡片、详情内容及缓存页面，覆盖首页/媒体库/详情、冷热缓存与 150 ms 模拟图片延迟。每组 11 类交互各重复 3 次，四组共 132 次。测量顺序为 Qt bitmap、WK DOM、Qt DOM、WK bitmap，期间没有并行构建。样本属于可行性验证，不是统计性能保证。

| 引擎与路径 | rAF 间隔中位数 / p95 / 最大值（ms） | ≥50 ms 间隔 / 总数 | 首次 rAF 后任务延迟中位数（ms） |
| --- | ---: | ---: | ---: |
| Qt / bitmap | 16.7 / 16.8 / 50.1 | 9 / 2123 | 4.9 |
| WK / bitmap | 17 / 19 / 56 | 1 / 2113 | 13 |
| Qt / DOM glass | 16.7 / 16.8 / 50 | 4 / 2135 | 18.9 |
| WK / DOM glass | 17 / 18 / 51 | 1 / 2123 | 21 |

这里测量的是 JavaScript `requestAnimationFrame` 回调间隔，**不是合成器实际呈现帧率**。≥50 ms 计数使用 0.5 ms 容差；最后一列是首次 rAF 之后的 MessageChannel 任务，受事件循环与计时精度影响，**不是输入到屏幕的延迟**。不能把两端数字直接解读为 60/120 fps 的显示保证。

两条路径也不具有相同画面质量：DOM glass 使用 7 px CSS 模糊；bitmap 使用 240 px 宽栅格、内部 5 px 模糊再放大。WK 的 OffscreenCanvas 2D context 没有 `filter` 支持，所以 WK bitmap 只作为兼容性对照，不能因为个别耗时更低就宣称优化成功。

## 结论与后续方向

共同夹具未证明替换 Qt 为 WKWebView，或仅切换到 iPad 的 DOM glass 路径，就能明显改善 Mac 流畅度。两端多数回调间隔都在约 17 ms；完整 DOM 场景还增加了同步准备工作。应先定位真实页面的转场准备与外观层协调，再决定是否迁移原生壳。

初轮实验曾混入一个重要干扰：Qt 顶层页面自动注入 `webAppearance`，裸 WK 没有。该轮性能数字已排除。单独诊断观察到入场 class 的增删触发缓存失效，使 `prewarm()` 首次返回 false、稍后才成功。受控 iframe 同时消除了所有顶层自动注入，因此不能将全部改善只归因于 `webAppearance`。

进一步的源码线索：外观脚本在 `ApplicationWorld`，原生网页脚本在 `MainWorld`；前者读取 `window.TigerestHomeTransitions.busy` 时，两侧全局并不自动共享。该协调问题值得在真实页面单独复现，目前没有据此修改生产代码。

Mac 源码为外层 Qt Quick 选择 OpenGL，而运行时 Qt WebGL 报告 `ANGLE Metal Renderer: Apple M4 Pro`；不能把整个 Qt 栈概括成“全部使用 OpenGL”。本轮没有测试修改 Qt Quick 为 Metal。

Xcode 列出了 `My Mac / Designed for [iPad,iPhone]` 目的地。直接打开普通 iphoneos 构建未成功；这不是通过该 Xcode 目的地运行的验证，也不证明该方式不可行。本报告的 WK 数据来自临时 macOS 宿主，没有宣称完整 iPad App 已在 Mac 运行。

本轮不覆盖真实 Emby 页面、视频播放、功耗、滚动惯性或硬件输入延迟。已安装播放器及其用户配置保持不变，临时测试配置均已清理。

## 本机验证材料

机器可读汇总保存在相邻的 `2026-10-14-mac-ui-probe-summary.json`。完整原始记录、源码快照、环境/哈希与临时探针保存在本机 `/tmp/tigerest-mac-ui-probe/`，临时目录可能被系统清理。其中 `controlled-*.jsonl` 是受控组，未带此前缀的初轮结果不能用于引擎性能归因。

iPad 测试与构建日志分别为 `/tmp/tigerest-validated-swift-final.log`、`/tmp/tigerest-0930ae1-app-build.log`；安装与启动结果为 `/tmp/tigerest-validated-ipad-install.json`、`/tmp/tigerest-validated-ipad-launch.json`。
