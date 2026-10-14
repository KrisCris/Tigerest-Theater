# Windows 界面帧率调查（2.6.1）

2026-10-14，Windows 11 23H2 / RTX 4090（驱动 616.64）/ 4K 240 Hz 主屏 + 60 Hz 虚拟副屏，Qt 6.9.3 + 自建 QtWebEngine 6.9.3（D3D11）。

## 结论

1. **网页合成器固定 60 Hz。** viz 只在 DirectComposition 可用时使用 vblank 驱动的 `ExternalBeginFrameSourceWin`；QtWebEngine 的离屏输出得到 `DelayBasedBeginFrameSource`，间隔需要 `SetDisplayVSyncParameters` 提供，而 Qt 从不调用，于是保持默认 1/60 秒。补丁 `qtwebengine-6.9.3-begin-frame-vsync.patch` 每秒用 `gl::VSyncProviderWin` 读取 DWM 参数；若与窗口所在屏幕的 `QScreen::refreshRate` 相差超过 5%，改用后者。
2. **平滑滚动默认关闭。** `QWebEngineSettings::ScrollAnimatorEnabled` 在没有 `--enable-smooth-scrolling` 时为关，`webview.qml` 改为打开。打开后每格滚轮只有 60 px（系统 3 行 × Qt 的 20 px），显得慢；`qtwebengine-6.9.3-wheel-step.patch` 在 Windows 上改为每行 50 px。
3. **花屏修复保留。** D3D11 生产者等待（`TIGEREST_D3D11_PRODUCER_WAIT`）在 240 Hz 下开关对照无可测帧率差别。改用 `ID3D11Fence` 需同时改 Chromium 与 Qt 两侧，收益只是省去 CPU 等待，暂不需要。

## 测量

合成测试页 `tests/perf/frame_pacing_fixture.html`（480 张渐变卡片、22 px 毛玻璃），`tests/perf/frame_pacing.cjs` 驱动，窗口最大化 3840×2034 物理像素（缩放 150%），隔离配置，每场景 4 秒。同一 DLL 以 `TIGEREST_WEBENGINE_VSYNC=0` 对照：

| 场景 | 修复前 fps | 修复后 fps | 修复后 p95 | 翻倍帧 | Qt 呈现/秒 | Chrome fps |
|---|---|---|---|---|---|---|
| 空 rAF | 60 | 240 | 4.2 ms | 0 / 961 | — | 240 |
| CSS 动画 | 60 | 232.8 | 4.3 ms | 29 / 931 | 60 → 233 | 240 |
| JS 动画 | 60 | 231.8 | 4.3 ms | 33 / 926 | 60 → 232 | 240 |
| CSS + 毛玻璃 | 60 | 232.0 | 4.3 ms | 32 / 927 | 60 → 232 | 240 |
| 平滑滚动 | 60 | 237.7 | 4.3 ms | 9 / 951 | 43 → 166 | 240 |
| 悬停卡片 | 60 | 220.5 | 8.3 ms | 72 / 881 | 60 → 220 | 239.3 |

转场基准 `tests/bench_home_motion.cjs --webengine --native-size --maximized`（模拟 Emby 数据）见发布说明表格：详情相关转场 57–60 → 179–213 fps，首页 → 媒体库 53 → 143–145，媒体库 → 首页 43–47 → 109–139。

真实服务器手动试用（全屏 3840×2160，页面内被动 rAF 探针按动画区段统计）：剧集页 → 详情 110–127 fps，单次转场 9–13 帧超过 25 ms，最长 80–270 ms；详情 → 剧集页 146–166 fps；页面内小动画 190–240 fps。模拟数据未覆盖这部分主线程停顿。窗口越大越明显，默认 1280×720 窗口的像素只有全屏的四分之一。

## 未采用的方案

| 方案 | 结果 |
|---|---|
| BeginFrame 相位相对 vblank 偏移 0–3 ms（DWM／Qt 两种基准） | 翻倍帧 30–66／约 900 帧，与偏移无关 |
| `QT_D3D_MAX_FRAME_LATENCY` 0／1／3（默认 2） | CSS 225–226 fps，无变化 |
| 缓存共享纹理句柄，不每帧 `CreateSharedHandle`／`OpenSharedResource1` | 无差别，导入本来 < 1 ms |
| 改用 `ExternalBeginFrameSourceWin` 由真实 vblank 驱动 | 与计时器持平（CSS 206–224 对 209–223 fps），补丁更大，撤回 |
| `--disable-frame-rate-limit` | CSS 1500 fps 且不与屏幕同步，rAF 反而 57 fps，不可用 |
| Chromium `WindowsScrollingPersonality`（Edge 式滚动曲线） | 用户试用与默认曲线区别不明显，不采用 |

## 遗留

- 约 3% 的帧停留两个刷新周期（Chrome 同场景为 0）。最相关的是 BeginFrame 送达延迟：客户端 rAF 回调中位晚 1–1.5 ms，Chrome 0.1 ms，可能来自 Chromium 计时器在 Windows 上按整毫秒等待。240 Hz 下不易察觉。
- 剧集页／媒体库 → 详情、媒体库 → 首页的首帧主线程工作（160–270 ms），属于网页端优化。
- 花屏复现脚本今天对旧 DLL 关闭等待也不再触发，失去检测能力；候选版本开启等待 6 轮哈希稳定；用户手动试用未报告明显问题，但没有单独确认媒体库悬停花屏。
- 未验证：真实视频播放与弹幕、窗口换到 60 Hz 屏的切换、动画期间功耗、Mac（推测同样受 60 Hz 计时器限制）。
