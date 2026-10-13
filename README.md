# Tigerest Theater / EMBY 大河版

把 Emby 媒体库、MPV 播放器、弹幕和作品讨论放在一起。支持 Windows、Apple Silicon Mac 与 Android，桌面端提供画质预设、离线下载和可选 RIFE AI 补帧。

[下载正式版](https://github.com/Tigerest/Tigerest-Theater/releases/latest) · [使用教程](https://github.com/Tigerest/Tigerest-Theater/wiki) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/Tigerest/Tigerest-Theater/issues) · [作者 B站](https://space.bilibili.com/12562485)

**当前版本：2.6.0。** Wiki 源文档同步保存在 [docs/wiki](docs/wiki/Home.md)。

**已知问题：** 部分 Windows 高刷新率环境下，窗口播放可能持续卡顿、增加输出丢帧，而全屏正常。2.6.0 尚未修复；遇到此现象请先使用全屏播放。详见[故障排查](https://github.com/Tigerest/Tigerest-Theater/wiki/Troubleshooting)。

客户端不包含影视资源。你需要已有的 Emby 服务器地址和账号；媒体库、播放与下载权限由所连接的服务器提供。本项目是非官方 Emby 客户端，与 Emby LLC 无隶属关系。

## 2.6.0 更新重点

- **跨服务器公共评论：** 同一部作品可以一起讨论。大河用户沿用 Emby 登录；自建 Emby 用户注册独立评论账号后，可查看评论、发言和回复。
- **头像随发言同步：** 大河头像由服务端同步，自建用户的头像来自自己当前登录的 Emby。头像同步失败可单独重试，已经发送成功的评论不会重新发送。
- **更清楚的账户规则：** 注册和修改密码按服务端公布的规则显示；新服务为 8–128 个字符，旧服务保持 12–128。外服 Emby 登录凭据只用于自己的服务器。
- **共享弹幕纠正：** 普通大河用户登录后即可保存手动选择的作品和集数关系，无需额外配置管理员文件。所有用户仍可读取共享匹配。
- **音量正确记忆：** 首次默认 100，旧版遗留的 0 恢复一次；之后记住手动设置，包括主动设为 0。
- **窗口操作：** Windows 支持左右边缘吸附、顶边最大化和拖出还原；首页「我的媒体」右侧提供全屏／窗口切换，顶部按钮统一样式。「首页 → 启动时自动全屏」默认关闭，下次启动生效。
- **完整中文教程：** 安装、评论账号、头像、消息与报错、弹幕、字幕、补帧和故障排查均有独立 Wiki 页面。

详情页统一显示「评论区」，大河的私人问题上报和评论管理继续保留。公共评论不会把私人报错公开。详细变化与验证范围见 [2.6.0 发布说明](docs/releases/2026-10-13-v2.6.0.md)。

## 下载与安装

| 平台 | 安装包 | 系统要求 |
| --- | --- | --- |
| Windows 安装版 | [2.6.0 EXE](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.6.0/TigerestTheater-2.6.0-x64.exe) | Windows 10 1903+ / Windows 11，x64 |
| Windows 便携版 | [2.6.0 ZIP](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.6.0/TigerestTheater-2.6.0-x64.zip) | 同上；完整解压后运行 |
| Android | [2.6.0 APK](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.6.0/TigerestTheater-2.6.0-android.apk) | Android 15+，arm64-v8a / x86_64 |
| Apple Silicon Mac | [2.6.0 DMG](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.6.0/TigerestTheater-2.6.0-arm64.dmg) | macOS 26+，M 系列芯片 |

包内已包含 MPV 和基础运行库，无需另装播放器。Windows RIFE 大型组件是可选扩展；已有 NVIDIA 1.0.0 扩展可以继续使用。正式 Mac 下载仅提供 Apple Silicon 版本。

[2.6.0 SHA-256 校验清单](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.6.0/TigerestTheater-2.6.0-SHA256SUMS.txt)与安装包放在同一发行页。

### 第一次使用

1. 下载对应平台安装包。Windows 安装版运行向导；便携版完整解压；Mac 将应用拖入「应用程序」；Android 安装 APK。
2. 打开客户端，选择「大河李斯特专属 EMBY」或「自建 EMBY」。
3. 自建服务器填写完整地址，例如 `http://192.168.1.100:8096` 或 `https://example.com/emby`，然后使用该服务器账号登录。
4. 进入作品详情并播放。需要调整播放选项时，打开 Emby 设置中的「Tigerest Theater 设置」。
5. 想参与公共讨论时，大河用户可直接进入评论区；自建用户点击「评论账号」完成注册或登录。

专属服务器的权限与开通说明请查看[作者 B站主页](https://space.bilibili.com/12562485)中的充电说明；下载客户端不会自动获得服务器权限。

Windows 安装包目前未做 Authenticode 签名。Mac 使用 ad-hoc 签名，尚未经过 Apple 公证；确认文件来自本项目后，可按系统提示在「系统设置 → 隐私与安全性」中允许打开。详细步骤见 [安装与更新](https://github.com/Tigerest/Tigerest-Theater/wiki/Installation)。

### 从旧版更新

客户端启动时后台检查正式版本，以右上角更新图标红点提示；也可在「客户端」设置中点击「检查客户端更新」。下载会核验文件大小与 SHA-256，支持暂停、继续和中断后的续传。

手动更新前完全退出客户端，包括 Windows 托盘。安装版覆盖安装；便携版备份并保留 `data`，使用完整新版文件；Mac 替换应用；Android 使用同签名正式 APK 覆盖安装。

旧版 Windows 的内置下载若反复失败，可从发行页手动安装一次。具体操作、跳过版本和校验方式见 [安装与更新](https://github.com/Tigerest/Tigerest-Theater/wiki/Installation)。

## 能做什么

### 浏览与播放

沉浸式首页展示当前账号可访问的媒体库和作品。首页默认优先继续观看，不足时补充最近入库，也可改为最近入库、发行时间或评分。内置 MPV 支持音轨、字幕、播放队列、选集和观看进度回传。

首页海报用红点标记尚有未观看内容的作品；剧集显示「观看进度：8/12」，表示已看 8 集、当前服务器共有 12 集。观看进度在首页显示后加载，播放返回时刷新。

桌面默认使用 GPU-Next，并提供 Render API 兼容模式。Windows 播放画面嵌入主窗口，Mac 使用独立播放窗口。设置按客户端、首页、音频、视频、字幕、MPV 画质与插件、弹幕样式和高级分类，支持搜索、即时保存与分类恢复默认值。

Android 提供双击暂停、横滑跳转、左右侧亮度／音量调节、长按临时倍速、防误触锁及选集。系统关闭自动旋转时保留当前方向。详见 [播放与设置](https://github.com/Tigerest/Tigerest-Theater/wiki/Playback)。

### 公共评论、头像与消息

电影和剧集按可靠的 TMDB 标识关联公共讨论；单集还需要明确的播出季集编号。详情页区分「作品评论」「本集评论」，每页 10 条主评论，可回复和删除自己的内容，正文最多 2000 字。

自建用户必须登录独立评论账号后才能读取或发送评论。这个账号与 Emby 账号分开；头像来自当前 Emby 的本人头像，发言时检查变化并按需同步。大河用户免注册，头像由服务端同步。

顶栏「消息」提供收到的消息与我的发言；大河用户还可查看我的报错及修复通知。详情页不再切换公共／本服评论；大河自动使用统一评论入口，保留旧回复、管理工具和私人问题上报，自建服务器使用公共评论账号。

缺少可靠作品编号或使用不支持的集序时，客户端会说明原因，避免把不同集数混到一起。参见 [评论账号与头像](https://github.com/Tigerest/Tigerest-Theater/wiki/Community) 和 [消息与私人报错](https://github.com/Tigerest/Tigerest-Theater/wiki/Messages-and-Reports)。

### 弹幕与共享校准

新配置默认启用弹幕，已有明确关闭的设置会保留。播放时先查共享匹配，再按作品、季度、集标题与集数自动识别；仍有歧义时可手动选择。

桌面与 Android 均可搜索、管理来源、调整时间偏移和样式。大河用户手动选择正确的作品与集数后，可使用当前 Emby 登录保存共享对应关系；保存失败仍能加载本次选择，并显示提示。自建用户可读取共享结果。

桌面内置弹幕下载和共享查询遇到超时或临时网络故障会等待 1 秒后自动重试一次；空结果和限流不反复请求，切集或手动换源会取消旧请求。

视频来自你的 Emby；弹幕搜索和匹配信息会发送到所用弹幕服务。手动配置的第三方来源保留原设置。操作示例见 [弹幕匹配与纠正](https://github.com/Tigerest/Tigerest-Theater/wiki/Danmaku)。

### 画质与 AI 补帧

桌面内置默认 Anime AA、真人影视、激进测试 Anime4K 三档画质；可以从菜单切换，也可以使用 `Alt+1`～`Alt+3`。日常先使用默认档，再按片源和设备调整。

RIFE 默认关闭，需要大河内置播放配置：

| 平台 | RIFE 方式 | 输入范围 |
| --- | --- | --- |
| Windows NVIDIA | 下载或离线导入 NVIDIA 1.0.0 扩展；三个 4.25 系列模型与可调目标帧率 | 最高逐行 SDR 4K / 60 fps；实际实时性能取决于设备和设置 |
| Apple Silicon Mac | 模型与插件随包提供，使用 Core ML / Metal | 最高逐行 SDR 1080p / 30 fps、恒定帧率，输出两倍帧率 |
| Android | 暂不提供 RIFE | 使用基础播放 |

首次 Windows 引擎准备可能需要数分钟。高目标帧率、4K 和重型模型会增加负载；屏幕刷新率不代表补帧推理能力。详细安装、目标帧率计算和排查见 [RIFE 补帧](https://github.com/Tigerest/Tigerest-Theater/wiki/RIFE)。

### 桌面离线媒体

服务器允许下载时，可创建下载任务，暂停、恢复或删除，并从下载与离线媒体管理中播放已完成文件。Android 当前不提供离线下载、后台持续播放或画中画。参见 [下载与离线播放](https://github.com/Tigerest/Tigerest-Theater/wiki/Downloads)。

## 中文 Wiki

| 我想要…… | 教程 |
| --- | --- |
| 从头开始使用 | [教程首页](https://github.com/Tigerest/Tigerest-Theater/wiki/Home) |
| 安装、更新、核验下载 | [安装与更新](https://github.com/Tigerest/Tigerest-Theater/wiki/Installation) |
| 连接自己的服务器或更换账号 | [服务器与登录](https://github.com/Tigerest/Tigerest-Theater/wiki/Server) |
| 注册评论账号、改密码、更新头像 | [公共评论与头像](https://github.com/Tigerest/Tigerest-Theater/wiki/Community) |
| 找回复、查看修复通知、上报问题 | [消息与私人报错](https://github.com/Tigerest/Tigerest-Theater/wiki/Messages-and-Reports) |
| 弹幕匹配错集、调时间或来源 | [弹幕教程](https://github.com/Tigerest/Tigerest-Theater/wiki/Danmaku) |
| 调播放、声音、画质或 Android 手势 | [播放与设置](https://github.com/Tigerest/Tigerest-Theater/wiki/Playback) |
| 选择字幕、修正延迟、保留 ASS 特效 | [字幕教程](https://github.com/Tigerest/Tigerest-Theater/wiki/Subtitles) |
| 安装与调试 AI 补帧 | [RIFE 教程](https://github.com/Tigerest/Tigerest-Theater/wiki/RIFE) |
| 下载作品并离线播放 | [下载管理](https://github.com/Tigerest/Tigerest-Theater/wiki/Downloads) |
| 解决异常或准备反馈 | [故障排查](https://github.com/Tigerest/Tigerest-Theater/wiki/Troubleshooting) · [常见问题](https://github.com/Tigerest/Tigerest-Theater/wiki/FAQ) |

## 反馈与支持

播放器问题请提交 [GitHub Issue](https://github.com/Tigerest/Tigerest-Theater/issues)，写明客户端版本、系统、复现步骤与错误提示。日志和截图请先删除密码、访问令牌及私人服务器信息。大河某部作品的播放或字幕问题，可直接在详情页「上报问题」中提交。

项目动态与支持入口：[大河李斯特视频工作室 / 大老师的 B站主页](https://space.bilibili.com/12562485)。

## 贡献者

- [大河李斯特（Tigerest）](https://github.com/Tigerest)：项目维护、开发与发布。
- [Claude](https://github.com/claude)：AI 辅助开发。
- [Codex](https://github.com/codex)：AI 辅助开发、调试与验证。

## 开发与许可

客户端源码在本仓库维护，评论和弹幕服务端单独维护。公开客户端源码不包含服务器资源、账号或访问权限。

- [Windows 构建](dev/windows/README.md)
- [macOS 构建](dev/macos/README.md)
- [Android 构建](android/README.md)
- [Windows 测试环境要求](dev/windows/TESTING.md)
- [版本变化](CHANGELOG.md)与[本次发布说明](docs/releases/2026-10-13-v2.6.0.md)

Windows 每次运行原生测试前，都必须在同一个 PowerShell 调用中加载测试环境脚本并完成运行库预检。测试、包启动检查、生产 API 联调和真实媒体播放的覆盖范围分别记录，不能互相替代。

项目沿用 Jellyfin Desktop 代码基础，并使用 MPV、Qt、[uosc](https://github.com/tomasklaen/uosc)、[uosc_danmaku](https://github.com/Tony15246/uosc_danmaku)、Anime4K 与 RIFE 等组件，感谢相关项目及贡献者。

主项目许可证见 [LICENSE](LICENSE)（GNU GPL v2）；第三方组件按各自许可证分发，具体来源、修改及许可文件随源码和发行包提供。
