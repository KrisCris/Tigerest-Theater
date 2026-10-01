# Tigerest Theater / EMBY 大河版

面向 Windows 和 Apple Silicon Mac 的 Emby 桌面播放器：MPV 播放、弹幕、RIFE AI 补帧、画质预设、离线下载，以及作品和单集评论区。

媒体库来自你连接的 Emby Server，账号和内容权限由服务器提供。本项目提供客户端，不包含影视资源，也不会自动开通服务器访问权限。

## V2.3 正式版

V2.3 将 Windows NVIDIA 与 Mac 的 RIFE 功能并入正式版，新增详情页评论区。版本变化见 [CHANGELOG](CHANGELOG.md)，完整下载和校验文件见 [GitHub Releases](https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.3.0)。

| 平台 | 下载 | 安装 |
| --- | --- | --- |
| Windows 10 1903+ / Windows 11 x64 | [安装版 EXE](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.3.0/TigerestTheater-2.3.0-x64.exe) | 按向导安装，可覆盖更新 |
| Windows 10 1903+ / Windows 11 x64 | [便携 ZIP](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.3.0/TigerestTheater-2.3.0-x64.zip) | 完整解压到可写目录，运行 `Tigerest Theater.exe` |
| macOS 26+，Apple Silicon M 系列 | [DMG](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.3.0/TigerestTheater-2.3.0-arm64.dmg) | 将应用拖入「应用程序」 |

基础包已包含 MPV 和所需运行库。Windows RIFE 的大型 AI 组件使用独立扩展，在客户端设置中下载或离线导入。下载文件可用发布页的 SHA-256 清单核验。

## 连接服务器

首次启动可选择「大河李斯特专属 EMBY」或「自建 EMBY」。专属服务器的权限与开通说明详见 B站充电页面；已获得权限的用户使用服务器账号登录。

连接自建服务器时，填写当前电脑可以访问的完整地址，保留协议、端口和反向代理路径，例如 `http://192.168.1.100:8096`、`https://emby.example.com` 或 `https://example.com/emby`。客户端会记住地址；连接失败时显示具体错误。更换入口可在设置中使用「重置已保存的服务器地址」。

## 评论区与回复

连接大河专属 Emby 并登录后，进入电影、剧集、季或单集详情页即可看到评论区。

- 电影、整部剧集和季详情显示**作品评论**；单集默认显示**本集评论**，可切换到作品评论。输入框上方标明当前发言对象。
- 评论和回复显示作者名称、头像及时间，支持分页加载。回复统一展示在主评论下，可继续回复其中任意可见内容。
- 使用现有 Emby 登录身份，无需另外注册，不支持匿名评论。正文为纯文字，可换行，最多 2000 字。
- 用户可以删除自己的评论。正文删除后，已有回复仍会保留，并显示删除占位。
- 评论管理员可删除单条内容或整条讨论、按 1 小时／1 天／7 天／永久禁言、解除禁言，并查看管理记录。管理员资格由评论服务配置。
- 网络发送失败时保留草稿，再次点击发送会复用同一次提交标识；频率限制会提示等待时间。退出登录或切换账号、详情页时清空当前评论状态和草稿。

当前评论区仅对大河专属服务器开放，自建 Emby 暂不显示。评论与弹幕共用 HTTP 18443：大河局域网连接使用局域网服务，域名连接使用域名服务。评论服务验证当前账号与媒体访问权限，头像请求也经过认证。服务暂不可用时可稍后刷新，媒体浏览与播放继续使用。

客户端源码公开，评论及弹幕后端单独维护，不包含在此仓库中。未来接入其他 Emby 服务器需要额外的身份信任规则。

## RIFE AI 补帧

在「MPV 设置」的视频设置中开启「AI 补帧（RIFE）」，再重新打开视频。补帧默认关闭，需使用大河内置播放配置。支持范围和性能取决于平台、硬件、输入格式及画质滤镜负载。

### Windows NVIDIA

在设置中下载或离线导入 **RIFE NVIDIA 1.0.0 扩展**，完成后完全退出并重启客户端。扩展包含 RIFE 4.25 lite、4.25、4.25 heavy 三个模型，以及独立的 TensorRT 运行库，无需另装 SVP、Python 或 CUDA Toolkit。

可选择均衡、画质优先、高帧率和 4K 流畅预设；使用整数倍插帧接近 60／120／240 fps。首次使用某个模型和输入尺寸时需要准备引擎，期间按原帧播放，准备完成后重新打开视频。扩展下载约 **2.00 GiB**，展开约 **2.49 GiB**，引擎缓存另占空间。

格式门槛最高为逐行 SDR 4K／60 fps 输入，程序不自动缩小推理尺寸或转换 HDR。性能不足、倍速播放或不支持的输入会恢复原帧播放。

实测 RTX 4090 的三个模型均通过合成素材 1080p30→60、默认画质处理后输出 4K 的 10 分钟测试。**1080p→240 和原生 4K60→120 仍属实验选项，尚未达到实时目标**，可能触发原帧回退。激进画质也会增加负载。详细测试边界见 [RIFE 实施报告](docs/reports/2026-09-30-windows-rife.md)。

### Apple Silicon Mac

M 系列 Mac 的模型及 Core ML／Metal 组件随基础包提供，支持最高 1080p、30 fps 的逐行 SDR 恒定帧率视频，以两倍帧率播放。HDR、4K、变帧率及色彩信息不完整的视频保持原帧播放，性能不足时自动回退。

## 其他主要功能

- **媒体库与原生播放：** 浏览、搜索、播放队列、音轨与字幕切换，观看进度回传；Windows 提供原生 GPU-Next 与 Render API 兼容后端。
- **弹幕：** 匹配、搜索、加载以及字号、透明度、速度、区域等调整；使用 Emby 剧集元数据辅助匹配，保留历史来源的屏蔽状态和时间偏移。
- **画质预设：** 默认 Anime AA、真人影视、激进测试 Anime4K 三档，可从播放菜单选择，或使用 `Alt+1`～`Alt+3`。
- **播放操作：** 内置 uosc 控制栏、中文字体和插件设置。MPV 控制台可在设置中开启，重启后生效。
- **MPV 配置：** 可选大河内置或系统配置；Windows 读取 `%APPDATA%\mpv`，Mac 读取 `~/.config/mpv` 或 `~/Library/Application Support/mpv`。
- **下载与离线：** 暂停、恢复和删除下载任务，完成后从「打开离线媒体」进入播放；下载权限由 Emby 服务器决定。
- **独立配置档：** 分别保存设置、缓存、日志、MPV 配置及离线文件。

专属服务器的内置弹幕服务随局域网／域名连接选择地址，自建 Emby 使用大河弹幕服务域名。视频仍来自你自己的 Emby；弹幕搜索词与匹配信息会发送到弹幕服务。手动配置的第三方弹幕来源保留原设置。

## 更新和排查

**更新：** 完全退出应用后覆盖安装；便携版先备份 `data`，完整解压新版再保留或迁移该目录，不要只复制 EXE。Mac 替换「应用程序」中的旧版。

**评论区未出现：** 确认使用 V2.3、大河专属 Emby 账号，以及电影／剧集／季／单集详情页。自建服务器和离线媒体暂不支持。加载失败时检查 HTTP 18443 是否可达；登录失效时重新登录。

**补帧未生效：** 开启后重新打开视频。Windows 安装扩展后须完全退出并重启；首次引擎准备未完成时仍以原帧播放。检查设置中的当前状态和格式／性能回退原因。

**Windows 媒体库画面异常：** 完全退出后尝试 `"Tigerest Theater.exe" --disable-gpu`，用于排查网页 GPU 渲染；视频硬解设置保持独立。

**Mac 提示无法打开：** 应用尚未经过 Apple 公证，确认来源后可在「系统设置 → 隐私与安全性」中允许打开。

问题反馈请提交 [GitHub Issue](https://github.com/Tigerest/Tigerest-Theater/issues)，附系统、版本、复现步骤和脱敏日志。删除账号、密码及访问令牌；评论错误中的请求编号可用于定位。

Windows 安装版日志位于 `%LOCALAPPDATA%\Tigerest Theater\profiles\<profile-id>\logs\`，便携版位于程序目录的 `data\profiles\<profile-id>\logs\`；Mac 位于 `~/Library/Logs/Tigerest Theater/profiles/<profile-id>/`。

## 源码构建

参见 [Windows 构建说明](dev/windows/README.md) 和 [macOS 构建说明](dev/macos/README.md)。RIFE 组件来源、校验与第三方许可见对应构建文档及包内许可证。开发构建需使用匹配的固定播放运行库。

本项目为非官方 Emby 客户端，与 Emby LLC 无隶属关系。
