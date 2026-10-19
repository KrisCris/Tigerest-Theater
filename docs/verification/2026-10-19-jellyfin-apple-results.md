# Jellyfin 2.9.0 Apple 验证与修复记录

日期：2026-10-19。接收完整历史包的 HEAD 为 `6736b4b45bb71923c2dc3bf564471e3aaa8933a9`，产品基线截至 `829c5f8`。在独立分支 `codex/jellyfin-290-apple-full-6736b4b` 执行；原 `codex/ipad-port` 工作区保持原状。本文件随修复提交保存，最终提交号、包 SHA-256 和后续发行包检查记录在同次回传的 `MANIFEST.json`、`Apple验收与Windows接收说明.md` 中。

## 已修复的问题

1. **TV 旧会话首次探测失败后，界面重试仍使用旧鉴权。** 将补充服务信息放到 `refresh()`，使显式重试重新探测；仅保存成功结果，沿用请求代次保护退出/切服后的迟到响应。新增用例先复现失败，再通过；TVHomeModel 共 35 项通过，涵盖失败后重试、保存后重启、退出和切服竞态。
2. **Legacy 缓存页面的重复 `homeTab` ID 阻止新首页挂载。** 从所有候选中选择实际可见的页，而非只取第一个 ID。Node 与真实浏览器回归先失败后通过；Mac 实际 12.2 Legacy 设置→首页往返确认隐藏旧页不挂载、可见新页挂载。
3. **iPad 中文字幕显示方框。** 打包仓库已有思源黑体与 OFL 许可；初始化 MPV 字体目录，将旧默认 PingFang SC/Segoe UI 映射到内置字体，保留其他选择及重置语义。打包器核对字体与许可哈希。修复前后均保存真机截图；修复后实际文字清晰可见，字幕设置和重置真机测试通过。没有把播放时钟当成字形正确的证据。
4. **旧 Jellyfin 组件兼容层激活转场快照，导致登录后停留在登录页。** 物理 iPad 上定位到 Custom Elements v0 遍历开放 shadow root 后重新激活静态 `emby-input`，其 `labelElement` 缺失引发异常。只在该兼容层存在时使用闭合 root，并通过 WeakMap 保留内部滚动恢复能力；原生 v1 路径不变。新增模拟遍历回归先失败后通过，另验证 iPad 缓存提升仍恢复 `[60,180]` 滚动位置。真实 10.11.11 登录、首页和 MPV 播放复测通过。

独立代码复查已完成。复查指出 TV 可选集成测试必须限制到独立验收 bundle ID，已补强；不允许测试退出正常安装版的用户会话。

## 环境与隔离

| 项目 | 实际环境 |
| --- | --- |
| Mac | Apple M4 Pro，arm64，macOS 27.2 / 26B5112a |
| Xcode | 用户指定的 Xcode-beta，27.2 / 27B5028f；进程级 `DEVELOPER_DIR`，未切换全局 Xcode |
| Apple SDK / 部署目标 | SDK 27.2；应用部署目标保持 26.0 |
| Swift | AppleCore 使用 CLT Swift 6.4 / macOS SDK 27.0；Apple 工程与 TV harness 使用 Xcode Beta |
| Qt | 6.9.3，本工作树独立 CMake 构建 |
| MPVKit | `d9194243bdc68b87d8989376ab52aee7da6c8e0b` |
| iPad 原生 MPV | `41f6a645068483470267271e1d09966ca3b9f413`，匹配 RIFE 资源 |
| RIFE 模型 | `bbfd2ea90910789a860ea3e2b32a240cd577b75e`，30 个缓存文件已核对 |
| 物理 iPad | iPad Pro 13 英寸 M5，iPadOS 27.2，USB 配对 |
| 物理 Apple TV | Apple TV 4K 第二代，tvOS 27.0 |

真机采用独立验收应用身份；iPad 使用 `UITestProfiles`，TV 集成测试显式要求独立 bundle ID。正常安装版及设置保留。Mac 使用独立测试 profile；安装位置提示的临时偏好在检查后恢复。设备 UDID、签名 Team、账号密码与 token 不写入回传。

本机建立五个官方 Jellyfin 实例：10.9.11、10.10.7、10.11.0、10.11.11、12.2（实际信息接口返回 12.2.0）。各自独立配置、数据库、缓存和临时账号；下载归档经过长度、SHA-256 与 xz 完整性核对。旧版未签名 Mach-O 仅在解压的测试副本作本地 ad-hoc 签名，原始归档不变。12.2 保持关闭旧鉴权，旧 header 实际返回 401。

媒体为生成的 45 秒 1280×720、24 fps H.264 短片，双 AAC 音轨、内嵌和外部 SRT、两个同名不同 ID 电影、两季四集。未扫描用户媒体库。根路径和严格 `/jellyfin` 反向代理分别测试，代理路径之外拒绝访问。子路径结果不等同于 Jellyfin 原生 BaseUrl 配置重启验证。

## 逻辑与受影响回归

| 层级 | 结果与本地证据名 |
| --- | --- |
| AppleCore | 109/109，`apple-core.log` |
| TV home | 35/35，`tv-home-model-green.log`；失败前证据保留 |
| TV playback / comments / danmaku | 35/35、7/7、5/5，分别见对应 harness 日志 |
| Node | 接收基线 55/55；共享修复后针对性 49/49，`shared-final-node.log` |
| Mac CTest | 基线 70/70；原生暂停单项 1/1 |
| 最后共享快照修复 | Mac 受影响 5/5，36.11 秒，`mac-snapshot-affected-ctest.log` |
| 闭合 root 滚动补测 | Chrome 通过；Qt 单项 1/1，16.78 秒，`mac-snapshot-scroll-ctest2.log` |
| 真实 Apple API | 五版×根/子路径 10/10；生产 AppleCore + TVAppModel/TVSessionStore，播放器替身，不宣称解码 |

真实 API 覆盖公开识别、鉴权、库和同名作品、详情/季集、图片 200、媒体 Range 206、外部字幕 200、开始/进度/停止上报和 12 秒续播。真实隔离 Mac Keychain 覆盖旧会话补字段、保存后新 model 恢复与退出；这不是物理 TV 的旧 Keychain 升级测试。

## 界面与播放证据

Mac 打包应用已完成五版×根/子路径真实登录、首页、详情、第二音轨/外挂字幕选择、MPV 连续时钟、暂停稳定、seek 20 秒并恢复及停止。合并 `mac-real-matrix.json`、`mac-real-matrix-recovered.json` 和 `mac-real-matrix-final-roots.json` 中最终成功结果；早期失败条目仍保留，不累计为成功。12.2 实际 Modern 和 Legacy 的设置入口、媒体夹选项、收藏往返、详情/播放已分别检查；Legacy 确认实际页壳而非只记录 localStorage。窗口 1280×720 与全屏 1800×1130 首页均为 top=0、bottom=viewport−8。原先误标 Legacy 的首次记录不计入结果。

iPad 模拟器基础 UI 14 项中首轮 12 项通过，下载和双击在补齐模拟器 ad-hoc Keychain entitlement 后复测通过。物理 iPad 的受控桥接 20 次播放/定位、离线下载及真正 WK 文档生命周期专项 2/2 通过；字幕字体设置/重置专项通过。真实 DIV SPA `pagehide` 不关闭桥，实际文档导航会拒绝 pending、清除订阅，新文档能重新调用原生 API。季集、跨季选择、手势和状态栏等属于受控 UI 夹具结果，不能泛化为五版真实服务器的完整场景矩阵。

快照异常修复后，物理 iPad 五版×根/子路径 **10/10** 完成真实登录、首页、详情、原生 MPV 播放、暂停稳定、恢复和退出播放。证据为 `ipad-11-snapshot-fixed.xcresult`（10.11.11 根路径）和 `ipad-fixed-matrix-<版本>-<路径>.xcresult`（其余九组）；`ipad-fixed-matrix.json` 记录这九组退出码均为 0。已实际查看修复后 10.11.11 帧截图中的视频与中文字幕。

物理 iPad 12.2 Modern、Legacy 横竖屏及每方向两次收藏往返均通过，随后正常进入详情和原生播放：`ipad-physical-modern-host.xcresult`、`ipad-physical-final-layout-desktop-legacy.xcresult`。Modern 实测竖屏 1032×1344、图库 top=0/bottom=1336，横屏 1376×1000、top=0/bottom=992；收藏页原导航恢复为 48px。早期 Modern 审计将跨文档导航放在同一个页面脚本内，页面替换使探针失联；改为宿主逐步点击和读取，未以伪造路由事件或修改产品换取通过。

Apple TV 模拟器遥控器 UI 7/7 通过，包含播放、字幕、季集与焦点。物理 TV 五版×根/子路径 10/10 完成登录、库/详情、MPV 播放时钟、暂停/恢复、退出播放、续播入口和退出登录；实际截图确认视频及中文字幕。共享字体初始化后的最新 12.2 子路径增补 seek +10 秒、关闭字幕、等待字幕面板退出后恢复播放并退出账号，`tv-final-extended2.xcresult` 通过。TV 无音轨切换 UI，不为验收增加功能。

Mac 可搬移包隔离播放基线通过：10.077 秒，startup/render/decode drops 均为 0，最大 A/V 差 17.973 ms；2531 条加载映像记录未见开发目录/Homebrew 依赖。首次与 UI 并行时 startup drops=26 的失败保留，最终性能结果取独立复测。该检查未启用 RIFE，不冒充完整 RIFE 性能矩阵。

## 远程 HTTPS 专用账号

用户提供专用测试凭据后，实际服务信息确认 Jellyfin 10.11.11。三端均使用正常 TLS 校验、真实 UI 登录和原生 MPV：

- Mac 打包 app：720p H.264/AAC，时钟从 40ms 推进至 5040ms；暂停后仍为 5040ms；定位 240 秒并恢复后为 241280ms。渲染 `gpu-next`、解码 `videotoolbox-copy`；MPV 解码帧已目视确认视频和中文字幕。Qt 页面截图在原生播放器显示期间超时，不把该失败或灰色窗口截图当成画面证据；`mac-https-final-summary.json` 单独说明最终有效帧的来源。
- 物理 Apple TV：`tv-physical-https-final.xcresult`，1/1 通过，63.617 秒；播放、暂停、+10秒定位、关闭字幕、恢复、退出播放/续播入口和退出登录。首轮 OSD 隐藏导致时钟查询失败，测试改为遥控器重新唤出 OSD 后再读，未修改播放器。
- 物理 iPad：`ipad-physical-https-settled.xcresult`，1/1 通过，49.069 秒；真实登录、指定测试媒体、原生时钟推进、暂停稳定、+10秒定位、退出播放。脚本适配公开用户列表的“手动登录”、触摸小海报先预览再打开，以及关闭 XCTest 动画等待后的首页入场稳定等待；早期选择器/点击失败保留，不算产品通过或产品修复。

远程原始 xcresult、日志、账号和媒体截图只保留在本机私密证据目录，不回传。公网短时播放成功不等于整部长片、人工听音、全部音轨/字幕格式或所有网络故障场景通过。

## 结果边界与后续接收

已收到并完整阅读 NAS 的《Mac追加交互验收要求》和《Mac动画缺失与卡顿专项补充》。后者明确 Windows Codex 已接管共享源码；Windows HEAD 为 `80e995e2155858f9ef6dc0d1351cdd4798389d06`，JF-11～JF-16 的最终增量 SHA 尚未交付。两份文件是验收要求，不是代码包。本报告和构建包仅代表现有基线加本地四项修复，不代表 2.9.0 全部交互完成。

收到上述边界后未再修改共享 `native/`。本轮此前已完成的两项共享 JS 改动保留为独立候选 patch；其中闭合快照 root 与 Windows JF-10 的 `is` 属性清理解决同一类问题。Windows 应对照真实 v0 复现、滚动恢复回归和新动画实现选取方案，不应同时盲套两个修复或覆盖工作区。Apple 专属改动另给 patch；接收后按各自环境补受影响回归，Apple 实测不能替代 Windows/Android。

JF-11 iPad 键盘语言/旋转组合、JF-12 详情响应式全场景、JF-13 完整动画和父详情返回链、JF-14 动态页头、JF-15 统一切服与历史收尾、JF-16 冷/热动画性能及同机 Emby 对照，均作为追加未完成项保留。收到最终共享增量后再构建并实测；tvOS 原生 SwiftUI 导航须另列，不能用共享 JS 结果代替。

未验证：人工听音、Intel Mac、长片完整播放/4K/HDR、原生 BaseUrl 重启、真实 CDN 跨源场景，以及五版每端全部 EOF/跨季/账号 A/B 和 Emby↔Jellyfin 组合。已有逻辑与夹具覆盖必须按其层级解释；未测项不是通过。远程测试仅使用用户明确提供的专用账号，产生必要的播放进度记录，未改服务器配置或媒体；没有推送、合并或发布。

最终普通 Release IPA 需由接收者重新签名。打包保留原有 26.0 最低系统要求，iPad 要求完整原生 RIFE 与模型，TV 禁止 RIFE 和测试媒体；不能通过删除打包断言或修改最低系统字段换取“成功”。最终包及矩阵补充结果见同次回传说明。
