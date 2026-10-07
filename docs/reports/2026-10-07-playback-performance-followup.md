# 2.4.3 试用修订：RIFE 调度、弹幕匹配和播放反馈

本轮仍为试用候选，不创建正式标签或 Release。日常安装目录和设置不变。

## RIFE 性能定位

用户提供的 SVP 对照使用 RTX 4090、标准 RIFE 4.25、TensorRT、4 个 GPU 流。客户端实际加载的是标准 4.25、implementation 2、FP16 输入输出、静态尺寸引擎；本轮没有改成 lite、降低分辨率或把源视频降为 8 位。

确认了两个独立瓶颈：

1. 最末端的统计 Monitor 使用 `fmFrameState`，串行化了上游请求。改为 `fmParallel`，并使统计支持乱序完成、去重及 seek epoch 隔离。并行回调测试实际从 1 提升至 2；百万帧乱序计数测试仍精确，测得私有内存增量为 0。
2. 修复并行后，当前 Windows gpu-next / D3D11 呈现链路使用 `display-resample` 仍持续丢帧。TensorRT 图挂载期间临时采用 `display-vdrop`；停止、失败、旁路和结束时恢复最近的用户偏好。显式选择其他同步模式时尊重该选择。CoreML 不应用此策略，结束回调不做同步 mpv 调用。

### 纯滤镜 A/B

同一 RTX 4090、标准 RIFE 4.25、1080p 10 位、24000/1001→60000/1001、2.5×。每组预热 3 秒、采样 10 秒；素材为合成测试帧，不代表所有真实片源。

| Monitor / 并发 | 吞吐 fps | 请求等待 P95 ms |
| --- | ---: | ---: |
| 不含 Monitor，2 流、prefetch 4 | 128.80 | 11.29 |
| 旧 Monitor，2 流、prefetch 4 | 64.53 | 29.00 |
| 并行 Monitor，2 流、prefetch 4 | 127.49 | 11.37 |
| 并行 Monitor，2 流、prefetch 2 | 109.69 | 13.46 |
| 并行 Monitor，4 流、prefetch 4 | 125.49 | 12.50 |

4 流没有优于 2 流，因此没有盲目增加 GPU 流数量。等待时间是整段滤镜请求耗时，不宣称等于单次 TensorRT kernel 时间。

### 完整 Player 呈现 A/B

真实 Qt Player / MpvVideoItem，标准 RIFE 4.25，1080p HEVC 10 位 23.976→59.94 fps，3840×2160 呈现区域、240 Hz 显示器、默认受管画质配置。使用 90 秒连续合成素材，未冒充用户的《乱马》片源。统计排除启动、截图暂停和恢复预热。

| 条件 | 采样时长 | 新增显示丢帧 | 最大采样音画偏差 |
| --- | ---: | ---: | ---: |
| 旧 Monitor + display-resample | 30.01 s | 1782 | 791.94 ms |
| 并行 Monitor + display-resample | 30.01 s | 546 | 85.50 ms |
| 并行 Monitor + audio | 30.01 s | 0 | 0.011 ms |
| 并行 Monitor + display-vdrop | 30.01 s | 0 | 10.98 ms |
| 最终自动策略，用户设置保持 display-resample | 60.01 s | 0 | 18.74 ms |

最终 60 秒样本视频时间推进 60.00995 秒，vfFps 为 59.94006，解码新增丢帧为 0，无性能警告。启动基线已有 13 个显示丢帧，不能宣称启动至退出全过程零丢帧。

另行运行 45 秒暂停/拖动检查：暂停时视频位置稳定、向前拖动 10 秒后 epoch 更新并恢复补帧，最终仍为 display-vdrop、59.94 fps，无性能警告。seek 会重置 mpv 丢帧计数，故不以“最终减初始”的负数作为该组丢帧结论。

这些结果验证了当前机器和测试规格下的修复，不替代用户实际影片、其他显示器、驱动及更长时段的验收。

实现依据：[VapourSynth FilterMode](https://www.vapoursynth.com/doc/api/vapoursynth4.h.html#enum-vsfiltermode)、[mpv video-sync](https://mpv.io/manual/stable/#options-video-sync)。display-vdrop 仍使用显示时钟，通过丢弃或重复帧处理漂移；不对音频重采样。

## 弹幕自动加载

- 新配置默认启用弹幕，已有明确关闭偏好保留。
- 搜索中的 `½` 正规化为 `1/2`。只有找到实际目标集才宣布匹配成功；候选缺集时继续查找。
- 由 Emby 传入首播日期，结合日期、标题和集号处理新旧同名作品、跨季连续编号；同日批量播出时遇到歧义不猜测。
- 用户已确认《乱马½》为新版连续第 25 集。只读弹弹play API 查到新版第三季第 1 集“修行DEディナー”，集 ID `199720001`、首播日期 2026-10-04；读取时有 2011 条弹幕。旧版候选只有 18 集，原逻辑在真正找到第 25 集之前就停止搜索。
- 完整 file-loaded → 初始化 → HTTP fixture → 解析 → 渲染回归覆盖自动开启、显式关闭、候选回退、旧版冲突、跨季历史和同日批量发布。生产 Emby 的额外 API 请求返回 401，因此不将 fixture 结果冒充生产 Emby 的端到端自动播放结果。

## Android 与窗口外观

- Android 长按倍速不再显示中央文字；按住加速、松手/取消恢复、其他手势提示及教程保留。Debug 单测和 Debug/Release 构建成功，签名及 16 KB 对齐验证通过，新 APK 已覆盖安装至 USB 手机。
- Windows 页头原本按 1.08em 预留滚动条宽度，而客户端滚动条为 9px。改用实际宽度并补齐背景，保持滚动条可拖动；真实 Emby CSS 的独立 Chromium fixture 验证 LTR/RTL 和设置按钮点击。此项不等同于生产媒体库所有页面的目视验证。
- 继续核验 Windows QtWebEngine 同步补丁，部署核心 DLL SHA256 必须为 `9d410e8aa09e04dcafe759dd4446895011976ad4577e7d7b1977ee8cc156902b`。

## 证据

最终 Windows 完整构建和安装成功；CTest 66/66 通过（132.02 秒），包括真实 VapourSynth/TensorRT 图、流式边界、Player 生命周期、补丁 WebEngine 启动以及网页设置/评论 fixture。每次原生执行均在同一 PowerShell 进程先加载测试环境。排除需要单独重新编译引擎的 `test_rife_inference`，本轮复用已验证的缓存引擎；不将其计作新引擎编译测试通过。

原始测量位于忽略目录 `build/ui-revision/`：`monitor-*.json`、`rife-standard-23976-*.json`。构建、安装和本轮整套测试分别记录于 `playback-final-build.log`、`playback-final-install.log`、`playback-final-ctest.log`。候选目录另附当前构建信息、摘要和测试报告。

清理七个 Playwright 临时快照的动作被自动审批拒绝，工具仅返回 `blocked by policy`；未换路径重试，这些文件不纳入提交或交付。此前自动启动手机应用并截图也遭同类拒绝，安装成功不能视为自动启动及真机手势验证成功。
