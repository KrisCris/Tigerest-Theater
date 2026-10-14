# iPad 手势、Mac shader 与 RIFE 验证

环境：Xcode 27.2 beta 2，最低 iPadOS 26，iPad Pro M5 / iPadOS 27.2，Personal Team。原配置和真实服务器登录保留；所有自动验证使用 UITestProfiles 和本地生成的 H.264/AAC 测试片，不产生生产服务器写操作。

## Android 手势对齐

对照 `android/app/src/main/java/top/tigerest/theater/PlayerGestures.kt` 与 `VideoControls.kt`：

- 横滑预览定位，松手提交，整屏跨度为片长与 90 秒的较小值。
- 手势起点在左半屏时调整亮度，右半屏时调整系统媒体音量；方向判定后不因跨越屏幕中线改变功能。
- 屏幕安全区域边缘保留 24 点；按钮、菜单和进度条优先接收触摸，普通按钮至少 44 点。
- 空白画面单击切换控制栏，双击播放/暂停；播放时长按临时至少 2×，松手、锁定、退出或切到后台恢复。
- 防误触锁阻止普通画面手势；短按解锁按钮无效，长按 0.6 秒解锁，辅助功能另有解锁操作。
- 首次使用显示手势说明；播放中的教程暂停/恢复尊重媒体代次和用户暂停意图；控制栏自动隐藏避开拖动和弹出菜单。
- 亮度在退出和应用失活时恢复原屏幕值；音量使用系统 MPVolumeView 公共滑块，恢复的是应用主动暂改的亮度，用户主动调整的音量会保留。
- 播放器显示期间，底层网页停止接收触摸和辅助功能操作，避免锁屏手势穿透到媒体库。

触控层通过 SwiftUI 的 UIGestureRecognizerRepresentable 注册，渲染用 MetalSurface 不参与命中。直接在 MetalSurface 添加 UIKit 手势会抢走覆盖按钮的点击，已由失败/通过的锁定、选集测试定位并修复。

## Mac 画质预设

资源生成器直接读取 `resources/mpv/mpv.conf.in` 的三个 profile，展开共同的 high-quality 继承，并复制其六份原始着色器和已有许可证说明：

| 预设 | Shader |
| --- | --- |
| 默认（Anime AA 高强度） | SSim、KrigBilateral、RAVU Zoom R3 |
| 真人影视高画质 | SSim、RAVU Zoom R3 |
| 激进测试（Anime4K 完整链路） | SSim、Restore CNN UL、Upscale CNN x2 UL、Thin HQ |

iPad 的初始选择仍为原生画质；播放器“画质 → 渲染与着色器”可选 Mac 预设。预设与导入配置按当前配置档保存；清除和切换先恢复全部旧参数，不残留上一套 shader 或缩放值；应用失败恢复上一选择。

模拟器已通过源文件逐字节/哈希一致性检查，以及 gpu-next 的实际 vo-passes 检查：放大时 RAVU、KrigBilateral、Anime4K 的相应处理步骤出现。不能把“shader 路径已设置”当成已执行。

真机曾暴露 `/private/var` 与 `/var` 的资源根路径标准化差异：文件存在，但安全路径前缀比较失败。统一标准化根目录与文件目录后再验证；不放宽路径限制。

## RIFE 实际移植尝试

`apple/Probes/RIFE` 是独立、显式运行的验证程序，正常 App 不包含此入口或模型。它直接编译现有的 `RifeEngine.mm`、`RifeCoarseMetal.mm`、`RifeMetalWarp.mm`，复用 Mac 安装包中的 six-stage Core ML 模型，先验证仓库所钉住的权重 SHA 和所有模型产物哈希。

真机运行 split-coarse-metal，1920×1080，t=0.5，完成六次实际推理：全部输出有限数，每帧 6,220,800 个 RGB float；恒定帧平均绝对误差约 1.12e-6。初次推理约 1093 ms，重置后首对约 34.7 ms，缓存稳定后的四次为 20.67 / 19.80 / 20.04 / 21.65 ms；特征缓存命中、每对仅一次新 encoder 推理，两个直接 Metal warp 输出缓冲生效。

这证明模型和 Core ML/Metal 算法能够在 iPad 运行，并非完整视频补帧验收。当前固定 MPVKit 的 iOS 二进制明确带 `-Dvapoursynth=disabled -Dlua=disabled`；Mac 接入依赖的 VapourSynth 插件/帧适配器无法直接加载。正常播放器保持 RIFE 不可用，后续需实现 iOS 解码帧到推理及呈现队列的接入，并覆盖时间戳、seek/换集代次、颜色信息、音画同步、掉帧和长时间热稳定性。上述六帧数据不能替代 10 分钟 1080p30→60 实播性能结果。

验证程序最初采用旧式 UIWindow 生命周期，在 iPadOS 27 上启动后退出；改为 UIScene 生命周期后运行成功。这是测试壳问题，不是模型加载失败。

## 已完成验证与边界

- AppleCore 28 项通过；iPad bridge 5 项通过；画质资源构建测试通过。
- iPadOS 26 模拟器的 8 项界面测试通过，覆盖 20 次加载/定位/停止及音频输出、音量/静音保留、选集、字幕设置、离线入口和手势；追加的双击播放/暂停、单击控制栏、锁定后滑动检查也已通过，共覆盖 9 个不同 UI 用例。
- 模拟器不支持真实屏幕亮度修改，MPVolumeView 也不提供可用系统音量滑块；其亮度固定 0.5。此处用界面反馈验证手势路由，系统属性另以真机验证。
- 真机系统音量 0.55→0.35→0.55，亮度约 0.838→0.3→0.838；属性更新异步，等待后确认恢复。原生播放实际为 gpu-next + VideoToolbox，音频输出 48 kHz。
- 清除 shader 使用 libmpv 的真实空列表；空字符串会留下 `[""]`。同时修正空 mpv_node 数组被回读为 null 的转换问题；用真机运行中清除/重新应用验证。
- 未声称完成真实服务器所有片源、HDR/杜比视界、10 bit、外部 ASS、多声道/蓝牙路由、长期功耗或完整首版移植验收。

## 最终真机补记

- 三套预设均通过实际加载、运行中清除（shader 数组确为空且抗振铃归零）、重新应用和返回原生画质，共五轮。
- 640×360 放大与 3840×2160 缩小两类本地测试片均以 VideoToolbox 解码、gpu-next 渲染，短测记录无丢帧；处理记录覆盖 RAVU、KrigBilateral、Anime4K Restore/Upscale/Thin 及 SSim 的实际 pass。
- 4K 缩小单独确认 SSim L2 两步、mean & R、final pass，运行中清除/重启预设也通过。短片检查不等于长时间高负载或 HDR 画质认证。
- Xcode 27 签名构建、严格签名校验通过；正常工程及可执行文件均确认不含 PlaybackValidation。开发测试程序被正常 App 覆盖，真实用户 Profiles 未被测试程序修改。

机器本地证据：`/tmp/tigerest-ipad-quality-device-result7.json`、`/tmp/tigerest-ipad-quality-downscale-result7.json`、`/tmp/tigerest-ipad-rife-result.json`。测试日志与设备标识不提交到 Git。
