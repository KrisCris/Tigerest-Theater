# Tigerest Theater / EMBY 大河版

连接 Emby 媒体库，使用内嵌 libmpv 播放视频，支持弹幕、字幕、画质预设和离线播放。媒体库界面来自你连接的 Emby Server Web UI。

**当前正式版：v2.0.18。** 本项目是播放器，不包含 Emby 服务器，也不提供影视资源。使用前需要拥有相应服务器的访问权限。

## 下载与安装

从 [GitHub Releases](https://github.com/Tigerest/Tigerest-Theater/releases/latest) 下载正式版；更新内容见 [更新记录](CHANGELOG.md)。

| 平台 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Windows 10 1903+ / Windows 11，x64 | [安装版 EXE](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-x64.exe) | 运行安装程序，按向导安装 |
| Windows 10 1903+ / Windows 11，x64 | [便携版 ZIP](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-x64.zip) | 完整解压到可写目录，运行 `Tigerest Theater.exe` |
| macOS 26+，Apple Silicon（M 系列） | [DMG 安装包](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-arm64.dmg) | 打开 DMG，将应用拖入「应用程序」 |

本次发布附带 SHA-256 校验文件。Windows 安装版和便携版都包含所需运行库，无需另装 MPV。

Mac 安装包内含 Qt、MPV、MoltenVK 及运行依赖，无需另装 Homebrew 或 MPV。安装包使用本地 ad-hoc 签名，未经过 Apple 公证；若被系统拦截，可在确认下载来源后进入「系统设置 → 隐私与安全性」允许打开。本版暂未提供 Intel Mac 安装包；源码构建方式见 [macOS 构建文档](dev/macos/README.md)。

## 第一次使用

首次启动会显示两个入口。鼠标悬停或使用键盘聚焦选项时，下方会显示对应说明。

### 连接大河李斯特专属 EMBY 服务器

适用于已取得大河专属服务器访问权限的用户。**权限与开通说明详见 B站充电页面**；下载播放器不会自动获得服务器权限。

客户端在服务器所在局域网内优先尝试局域网地址，无法连接时尝试域名；其他网络使用域名。连接后使用你的服务器账号登录。

### 连接自建 EMBY 服务器

填写**你自己的**服务器完整地址，包括协议和端口，例如：

```text
http://192.168.1.100:8096
https://emby.example.com
https://example.com/emby
```

如果使用端口转发，应填写浏览器中实际可访问的外部端口；如果使用反向代理的子路径，也要保留该路径。客户端会记住本机填写的地址；自建服务器连接失败时，会停留在该地址并显示错误。

已有用户会继续连接已保存的服务器。需要重新选择时，在客户端设置中使用「重置已保存的服务器地址」。

## 主要功能

- **媒体库与播放：** 登录、媒体浏览、搜索、音视频播放、队列、字幕、远程控制与播放进度回传。媒体库内容和账号权限由所连接的 Emby 服务器决定。
- **弹幕：** 内置 uosc_danmaku，支持匹配、搜索、加载与样式调整；请求由播放、搜索等操作触发。Emby 剧集元数据可用于匹配，历史来源的屏蔽与时间偏移会保留。
- **画质与字幕：** 内置 uosc、中文字体及「默认（Anime AA 高强度）」「真人影视高画质」「激进测试（Anime4K 完整链）」三套 Shader 预设，可在播放菜单或通过 `Alt+1`～`Alt+3` 切换。
- **MPV 配置：** 提供「大河内置」和「系统 MPV 配置」两种模式。系统模式读取 Windows `%APPDATA%\mpv`，或 macOS `~/.config/mpv` / `~/Library/Application Support/mpv`。
- **下载与离线：** 原生下载管理支持暂停、恢复和删除；已下载的媒体可从「打开离线媒体」进入并播放。是否能下载仍受服务器权限与媒体可用性影响。
- **独立配置档：** 各配置档分别保存设置、缓存、日志、MPV 配置和离线文件。

### 弹幕服务如何选择地址

| 最初连接的 Emby | 内置弹幕服务 |
| --- | --- |
| 大河专属服务器，使用局域网地址 | 大河弹幕服务的局域网地址 |
| 大河专属服务器，使用域名 | 大河弹幕服务的域名 |
| 用户自建 Emby | 大河弹幕服务的域名 |

自建 Emby 的视频仍由用户自己的服务器提供。弹幕搜索词、匹配信息等会发送给弹幕服务；弹弹play 应用密钥由转发服务端保存，用户无需在播放器中填写。切换局域网与域名时，内置弹幕来源的历史地址会同步调整；手动配置的第三方弹幕服务保留原设置。

## 更新与常见问题

**如何更新？** 安装版可在退出客户端后覆盖安装。便携版请先备份原目录内的 `data`，完整解压新版，再保留或迁移该数据目录；不要只复制 EXE。macOS 退出应用后替换「应用程序」中的旧版本。

**浏览器能打开，自建入口却连接失败？** 先确认两者在同一台电脑、同一网络下访问相同的完整地址。新版会显示 HTTP 状态或网络错误，并保留填写的端口和路径。反馈时请附上系统、客户端版本、地址形式及完整错误文字，并去掉账号、密码和 token。双路由或跨网段环境还需要确认该电脑到目标地址的路由；仅凭“浏览器能打开”无法断定所有故障原因。

**Windows 媒体库花屏？** 正式包包含 QtWebEngine D3D11 同步修复。如果仍有问题，完全退出应用后可用 `"Tigerest Theater.exe" --disable-gpu` 启动以排查网页渲染；它不改变 MPV 视频硬解和 Shader 设置。

**在哪里调整播放与弹幕设置？** 使用主页面的「MPV 设置」及播放中的 uosc 菜单。MPV 命令控制台默认关闭，可在「MPV 画质与插件 → 启用 MPV 控制台」中开启，重启后生效。

遇到问题可提交 [GitHub Issue](https://github.com/Tigerest/Tigerest-Theater/issues)，说明复现步骤并附上脱敏日志。Windows 安装版日志通常位于 `%LOCALAPPDATA%\Tigerest Theater\profiles\<profile-id>\logs\`，便携版位于程序目录下的 `data\profiles\<profile-id>\logs\`；macOS 日志位于 `~/Library/Logs/Tigerest Theater/profiles/<profile-id>/`。

## 构建

- Windows：参见 [`dev/windows/README.md`](dev/windows/README.md)。
- macOS：参见 [`dev/macos/README.md`](dev/macos/README.md)。

Windows 打包目标：

```powershell
cmake --build build --target windows_all
```

macOS 26+ 打包：

```sh
dev/macos/setup.sh
dev/macos/build.sh
dev/macos/test.sh
dev/macos/bundle.sh
```

本项目是非官方 Emby 客户端，与 Emby LLC 无隶属关系。第三方组件许可见源码树和安装包内对应文件。
