# Jellyfin 连接与兼容范围

Tigerest Theater 2.9.0 起，Windows 与 Android 客户端可以连接 Jellyfin 服务器；Mac、iPad 与 Apple TV 的支持随苹果端 2.9.3 发布（苹果三端从 2.8.0 直接升级到 2.9.3）。具体验证范围见 [验收记录](verification/2026-10-19-jellyfin-2.9.0.md) 与 [2.9.0 发布说明](releases/2026-10-19-v2.9.0.md)；2.8.0 及更早版本不支持 Jellyfin。

## 连接自己的服务器

在自建服务器入口输入完整地址，再使用该 Jellyfin 服务器的账号登录。不要选择大河专属 Emby 入口来登录自己的 Jellyfin。

| 部署方式 | 地址示例 |
| --- | --- |
| 局域网 HTTP | `http://192.168.1.100:8096` |
| HTTPS 域名 | `https://media.example.com` |
| 反向代理子路径 | `https://media.example.com/jellyfin` |

保留维护者提供的子路径，不填海报、影片文件或单集详情的地址。Jellyfin 支持 Base URL；漏掉它可能导致网页、图片或播放请求访问错误位置。[Jellyfin 网络说明](https://jellyfin.org/docs/general/post-install/networking/#base-url)

登录后先确认媒体库和一部作品的详情，再检查播放、暂停、拖动、字幕与退出后的续播。遇到错误，记录客户端版本、服务器完整版本、平台，以及使用 Modern 还是 Legacy 布局，反馈时隐藏账号、Token 和私有地址。

## 适配范围

Windows 与 Android 实际测试了 Jellyfin 10.9.11、10.10.7、10.11.0、10.11.11、12.2，并保留原有 Emby 功能。测试覆盖连接、登录、媒体浏览、播放器接入、音轨/字幕、播放进度、支持平台上的下载与首页逻辑；尚未测试的版本与设备不标注为已兼容。

首页沿用服务器提供的作品身份进行合并；没有可靠作品身份时按条目 Id 显示。同名作品不会仅因标题相同被合并。Jellyfin 新旧版本提供的字段不同，不能保证服务器缺少共同身份的两个条目也自动合成一张卡。

## 账号和平台能力

媒体账号用于所连接的 Jellyfin 服务器。公共评论账号是另一套账号；接入 Jellyfin 不会自动开通大河专属身份、私人报错、共享绑定写入或一起看权限。自建服务器凭据不能作为中央评论服务的登录凭据。

本次服务器适配不改变各端既有能力边界：Android 不因此新增离线下载或桌面 RIFE；Apple TV 不因此新增一起看或 RIFE。以具体平台已有功能和 2.9.0 最终验收为准。

## 连接异常

1. 在同一设备浏览器访问相同地址，确认协议、端口与子路径正确。
2. 区分连接失败、账号被拒绝、网页功能未出现和视频无法播放，保留具体错误。
3. Jellyfin 12 默认禁用旧鉴权，并移除了内建旧 API 前缀。兼容应由客户端实现，不把修改服务器旧鉴权开关作为正常使用前提。[Jellyfin 12 说明](https://jellyfin.org/posts/jellyfin-release-12.0/)
4. Jellyfin 12 的 Modern 与 Legacy 布局分别验收；一种布局能播放不代表另一种布局的首页与扩展入口已通过。

开发定位见 [接口报告](reports/2026-10-19-jellyfin-api-audit.md)，发布范围见 [2.9.0 说明](releases/2026-10-19-v2.9.0.md)。
