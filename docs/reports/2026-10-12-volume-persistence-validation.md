# 音量退出后变为 0 的回归验证

## 根因与修复

`native/inputPlugin.js` 的系统媒体通知将网页音量百分数除以 100 后传给 `PlayerComponent::notifyVolumeChange`。该方法此前直接发送 `volumeChanged`，而 mpv 的同名观察信号以及 `mpvVideoPlayer` 接收方使用百分数。网页收到 1 后会保存 0.01，并再次发出通知，最终把保存值递减为 0。当前 mpv 的播放音量仍可为 100，因此故障在下一次读取保存值时才表现为无声。

修复在 `notifyVolumeChange` 边界乘以 100，统一 `volumeChanged` 为百分数；MPRIS 消费边界除以 100，保持其 0～1 音量语义。没有新增设置、强制重置音量或覆盖合法的静音值。

## 先失败再通过

- 原生回归 `webVolumeNotificationsUseNativeUnits` 在修复前失败：上报 1 时，信号实际为 1，期望 100。修复后覆盖 100、37、23.5、0。
- 新增 `test_volume_persistence_webengine`，加载发行程序内的两份生产网页插件，通过真实 QWebChannel 和 mpv 播放本地静音 WAV。修复前稳定得到 `expected=100, web=0, native=100, saved=0`；修复后 100、37、0 的网页音量、原生音量、保存值和新建播放器恢复值全部一致。
- 定向 CTest：`test_rife_player_lifecycle`、`test_player_lifecycle`、`test_volume_persistence_webengine`，3/3 通过。原生生命周期内部为 21 passed、0 failed、0 skipped。
- 客户端与原生测试定向构建成功，并已执行 `cmake --install build` 更新工作区暂存包。部署工具有既有的 `qtposition_nmea` 可选插件找不到 `Qt6SerialPort.dll` 警告；没有音量测试加载错误。

每次原生测试都在同一 PowerShell 调用中先读取 `dev/windows/TESTING.md` 并 dot-source `dev/windows/Enter-TestEnvironment.ps1`。

## 实际关闭与重启

用 computer-use 的窗口输入操作工作区暂存客户端，使用单独临时 profile、固定本地页面源与本地静音 WAV。实际点标题栏关闭按钮、按 Alt+F4；未替换为进程终止或退出 API。

| 步骤 | 启动恢复值 | 本次保存值 | 实际退出方式 | 下次启动结果 |
|---|---:|---:|---|---:|
| 1 | 100 | 100 | 标题栏关闭按钮 | 100 |
| 2 | 100 | 37 | Alt+F4 | 37 |
| 3 | 37 | 0 | 标题栏关闭按钮 | 0 |
| 4 | 0 | 0 | Alt+F4 | 测试结束 |

四次进程正常退出，退出码均为 0。临时配置和窗口已清理。原始结构化结果位于 `data/2026-10-12-volume-restart.json`。

这验证了生产原生桥接、播放器脚本、实际客户端退出和本地持久化；Emby 事件总线与 appSettings 由隔离 fixture 提供，没有访问生产账号或服务器，没有修改已安装客户端或真实配置。没有验证 Linux MPRIS 运行时，也未在此子任务中运行整套项目测试。

已被旧版写成 0 的设置与用户主动静音无法区分；修复保留 0，用户之后调整的音量会正常记忆。
