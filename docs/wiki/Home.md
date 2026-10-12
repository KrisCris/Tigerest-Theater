# Tigerest Theater 使用教程

这里是 EMBY 大河版的中文使用说明，对应 2.6.0。 客户端支持 Windows、Apple Silicon Mac 与 Android；播放内容和访问权限来自你连接的 Emby 服务器。

## 第一次使用

1. 按设备选择并安装[正式版本](https://github.com/Tigerest/Tigerest-Theater/releases/latest)：见[安装与更新](https://github.com/Tigerest/Tigerest-Theater/wiki/Installation)。
2. 选择大河专属入口或填写自己的 Emby 地址：见[服务器与登录](https://github.com/Tigerest/Tigerest-Theater/wiki/Server)。
3. 登录服务器，打开一部作品并播放：见[播放与设置](https://github.com/Tigerest/Tigerest-Theater/wiki/Playback)。
4. 根据需要选择字幕、检查弹幕。先用默认设置播放，再调整画质或启用补帧。
5. 自建 Emby 用户想看公共评论时，打开详情页的「评论账号」完成独立注册或登录。

## 按任务查找教程

| 任务 | 页面内容 |
| --- | --- |
| [安装与更新](https://github.com/Tigerest/Tigerest-Theater/wiki/Installation) | 系统要求、安装版与便携版、覆盖更新、更新红点、SHA-256 |
| [服务器与登录](https://github.com/Tigerest/Tigerest-Theater/wiki/Server) | 地址格式、反向代理路径、切换服务器、媒体权限、两种账号 |
| [公共评论与头像](https://github.com/Tigerest/Tigerest-Theater/wiki/Community) | 注册、密码规则、发言与回复、头像同步、统一评论入口 |
| [消息与私人报错](https://github.com/Tigerest/Tigerest-Theater/wiki/Messages-and-Reports) | 回复、我的发言、报错、日志附件、修复通知与已读状态 |
| [弹幕匹配与纠正](https://github.com/Tigerest/Tigerest-Theater/wiki/Danmaku) | 自动匹配、手动选集、共享校准、来源屏蔽与偏移 |
| [播放与设置](https://github.com/Tigerest/Tigerest-Theater/wiki/Playback) | 设置入口、声音、画质、快捷键、Android 手势与防误触 |
| [字幕](https://github.com/Tigerest/Tigerest-Theater/wiki/Subtitles) | 选轨、外置字幕、时间偏移、样式与 ASS 特效 |
| [RIFE 补帧](https://github.com/Tigerest/Tigerest-Theater/wiki/RIFE) | Windows 扩展、Mac 内置补帧、目标帧率、性能检查 |
| [下载与离线媒体](https://github.com/Tigerest/Tigerest-Theater/wiki/Downloads) | 桌面下载任务、离线播放、数据保留与权限 |
| [故障排查](https://github.com/Tigerest/Tigerest-Theater/wiki/Troubleshooting) | 按现象定位问题、日志目录、提交有效反馈 |
| [常见问题](https://github.com/Tigerest/Tigerest-Theater/wiki/FAQ) | 平台区别、账号范围、补帧与共享功能的常见疑问 |

## 2.6.0 用户需要知道的变化

自建 Emby 现在可以加入公共讨论。你需要另建评论账号，Emby 账号仍负责访问自己的媒体库；大河用户继续免注册。头像在发言时同步，更新自己 Emby 的头像后再发言即可触发检查。

注册和改密页面直接显示密码范围：新评论服务为 8–128 个字符，遇到旧服务则显示 12–128。登录已有账号时仍使用原密码。

大河用户手动纠正弹幕后，可用现有登录保存共享匹配。读取共享弹幕不需要注册公共评论账号。音量首次默认 100，旧版遗留的 0 恢复一次，之后正常记住手动音量，包括主动设为 0。

首页海报增加未观看红点，剧集显示「观看进度：8/12」，按当前账号已看集数和服务器现有集数展示，播放返回时刷新。

桌面增加首页「我的媒体」旁的全屏／窗口按钮，以及「首页 → 启动时自动全屏」。启动偏好默认关闭，手动切换不修改该偏好。

**已知问题：** 部分 Windows 高刷新率环境下，窗口播放可能持续卡顿、增加输出丢帧，而全屏正常。2.6.0 尚未修复；遇到此现象请先使用全屏播放。详见[故障排查](https://github.com/Tigerest/Tigerest-Theater/wiki/Troubleshooting)。

## 各平台功能范围

| 功能 | Windows | Apple Silicon Mac | Android |
| --- | --- | --- | --- |
| Emby 浏览、MPV 播放、弹幕、公共评论 | 支持 | 支持 | 支持 |
| 桌面画质预设和系统 MPV 配置 | 支持 | 支持 | 使用 Android 可用设置 |
| RIFE | NVIDIA 可选扩展 | Core ML / Metal，随包提供 | 暂无 |
| 下载与离线媒体管理 | 支持 | 支持 | 暂无 |
| 后台持续播放、画中画 | 按桌面窗口使用 | 按桌面窗口使用 | 暂无 |

具体安装包和验证范围以[对应版本发行页](https://github.com/Tigerest/Tigerest-Theater/releases)为准。遇到问题先看[故障排查](https://github.com/Tigerest/Tigerest-Theater/wiki/Troubleshooting)；项目与支持入口见[项目主页](https://github.com/Tigerest/Tigerest-Theater)和[作者 B站](https://space.bilibili.com/12562485)。
