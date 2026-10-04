# 2.4.0 消息中心与高刷新率适配

日期：2026-10-05。基于现有 community-message-center 工作分支继续完成，不包含独立私有后端源码。正式接口来自用户提供的 `Y:/community-api.md`，已同步到 `docs/community-api.md`。

## 消息中心

- 使用 GET `/me/comments`、GET `/me/replies` 和 POST `/me/replies`；不发送 Item 头，不接受客户端自选用户。旧草稿的 /messages、时间戳已读水位和 /context 路径不用于消息中心。
- 列表按真实数据结构区分 comment、reply、originalComment 和 location。全部已读使用当前列表返回的不透明 readThroughToken；后台轮询只更新未读数，不能换掉该快照。过期快照刷新后提示再次操作，不自动吞掉新消息。
- 503 保留最近成功列表及计数；账号切换、退出和登录失效清理私有内容及待处理请求。正文为纯文本；隐藏、删除和无访问权限有占位。canNavigate=false 仍可查看作品。
- 精确跳转先打开服务端提供的 Item 与 scope，再用 root/comment 的 anchorId 分页；携带 Item 授权，后续仅用 nextCursor。目标失效时显示当前可访问讨论。
- 后端健康检查实际返回 200/enabled=true；未认证的消息请求实际返回 401/AUTH_REQUIRED。本次浏览器流程使用隔离 fixture，不将其声称为真实账号读写验收；没有向生产服务写入评论或改变已读状态。
- 私有后台已独立部署到局域网 18444。原未跟踪 web 管理页面草稿保留，未加入本次客户端发行包。

## 高刷新率原因与方案

RTX 4090 / 4K 240 Hz 主屏与 60 Hz 副屏，用户已关闭 VRR 和外部限帧。此前在同一内置 RIFE 链路的 240→120→240 对照中，120 Hz 的约 35 秒采样保持 47.952 fps 补帧且没有新增输出丢帧；240 Hz 两次采样分别在约 14–15 秒后触发保护回退。SVP 不一定发生同样的回退，因此即使统计 jitter 更高，也可能比回退到原帧的内置链路更流畅。源帧率／补帧倍率与呈现统计是不同指标。

最小复现去掉 RIFE、网络及自定义 shader：240 Hz 窗口播放 GPU fresh 平均约 0.126 ms，20 秒仍出现 37 次输出丢帧；同设置改用音频时钟，该轮没有输出丢帧。全屏独立测试也存在稳定的 240 Hz 结果。因此证据指向 Windows 呈现调度和显示同步反馈，不能把 240 Hz 一概视为算力不足，也不能声称已唯一定位到显卡驱动或 DWM 的某一个缺陷。

240 Hz 的一个扫描周期仅约 4.17 ms，是 120 Hz 的一半。显示同步还涉及定时反馈、排队、交换链等待和桌面合成。重复显示缓存帧通常比重新推理轻得多，但仍有呈现调度工作；性能余量不保证每次呈现都按时。客户端 Qt 与原生 mpv 子窗口的组合与独立 mpv 全屏路径也不同。没有可用的 PresentMon ETW 结果，未证明实际 PresentMode。

2.4 增加 Windows「高刷新率兼容」，默认开启：仅在显示重采样、刷新率超过 120.5 Hz（给 120 Hz 报告值留容差）时采用音频时钟。可以关闭；明确选择音频或丢补音频时不改写其选择。其他平台、120 Hz 及以下保留原策略。窗口换屏触发配置更新。Windows RIFE 的既有生命周期音频同步与性能保护继续保留。系统 mpv.conf 及高级手动覆盖优先。此方案不改变物理刷新率，不是 240 Hz 输出下锁 120 fps。

音频时钟按视频／音频时间推进，可能发生正常的分数帧率重复或丢帧；mpv 的时域混合插帧需要 display 同步，但 RIFE/SVP 滤镜仍可运行。音频模式下 estimated refresh/jitter 可能为空或保留之前的显示同步统计，不可当作新的物理屏幕测量或 jitter=0。

## 2.4 实际客户端验证

使用本轮 build/output 的 2.4.0 QtWebEngine + gpu-next/D3D11 客户端，独立配置、本地 640×360 / 48 fps H.264/AAC 视频、默认三个 shader，窗口呈现尺寸 1920×1080，显示器保持 240 Hz。无真实 Emby 账号、无 RIFE；这轮用于验证新增通用高刷策略，既有 RIFE 真实网络视频证据见 [10-03 报告](2026-10-03-windows-rife-client-prepare.md)。

| 设置 | 测量时长 | 同步 | 新增输出丢帧 | 新增解码丢帧 | 最大采样音画偏差 |
| --- | --- | --- | --- | --- | --- |
| 兼容关闭 | 20.03 秒 | display-resample | 28 | 0 | 19.669 ms |
| 兼容开启 | 20.03 秒 | audio | 0 | 0 | 0.005 ms |

切换后实际帧率保持 48 fps。另验证高级 video-sync 手动覆盖有效；移除覆盖并重新加载后恢复高刷策略。数据见 [采样摘要](data/2026-10-05-client24-high-refresh.json)。短采样支持该环境的改善，不代表所有视频、所有 GPU 或长时间播放均无抖动。

## 测试与交付记录

- 请求层 11/11，相关 Node 回归 26/26，Chromium 消息流程通过。
- 原生高刷模式选择及换屏通知均观察到预期失败后修复通过；RIFE 生命周期、运行库、扩展与保护测试通过。
- 全量 CTest 首轮 47/51。四个 UI 测试中，三项受测试环境 WebEngine 资源覆盖影响，旧安装版同样超时；一项 fixture 配置目录不是有效 UUID。去掉无效覆盖并修正 fixture 后四项复跑通过。随后最终全量 CTest 51/51 通过。最终复核另发现较早请求返回 401 会被列表版本号忽略的问题；补上两个失败场景并修复后，Chromium 与实际打包脚本的 QtWebEngine 流程均通过（43 次 fixture 请求），重新编译后的完整 CTest 再次 51/51。
- 构建环境曾漏配 MPV DLL 和 Qt 平台插件，已写入 `AGENTS.md`、`dev/windows/TESTING.md` 与 `Enter-TestEnvironment.ps1`，测试前检查依赖；不再依赖会丢失的临时 shell 环境。

## 参考源码与文档

- [mpv video-sync](https://mpv.io/manual/master/#options-video-sync)：音频时钟与显示时钟的语义、限制。
- [所用 mpv D3D11 context](https://github.com/mpv-player/mpv/blob/dd5d17d32/video/out/d3d11/context.c)：Present 与帧统计反馈；sync interval 非 1 时不能直接沿用相同精确反馈统计。
- [mpv VO 时序](https://github.com/mpv-player/mpv/blob/dd5d17d32/video/out/vo.c)：重复呈现、时间统计与退化路径。
- [DXGI flip model](https://learn.microsoft.com/en-us/windows/win32/direct3ddxgi/for-best-performance--use-dxgi-flip-model)：窗口、合成与呈现路径条件。

## 最终复核与取舍

独立审查发现的同账号旧轮询／旧标签 401 问题已修复：身份失效不受页面版本号过滤，跨账号保护保留。未发现其他需阻止交付的缺陷。

沿用当前功能分支，不自动合并或发布 GitHub；旧后台／八月文档草稿不纳入发行改动。生产账号写入和更多 GPU／长时性能不在本轮验证范围，因此未改动生产消息已读状态，也不据短测作通用保证。窗口原有指针生命周期保留，新增信号连接由 QObject 管理。超过 120.5 Hz 的阈值根据现有对照与标称刷新率容差选择，未测硬件可关闭兼容选项。私有后台部署由服务端负责，本客户端只对接正式契约。
