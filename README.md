# Tigerest Theater / EMBY 大河版

一款支持 Windows 和 macOS 的 Emby 桌面播放器，集成 MPV 播放、弹幕、画质预设和离线下载。

连接已有的 Emby 服务器，即可浏览媒体库、观看视频。使用前请准备好服务器地址和账号。

## 下载与安装

**当前正式版：v2.0.18。** 完整下载列表见 [GitHub Releases](https://github.com/Tigerest/Tigerest-Theater/releases/latest)，版本变化见 [更新记录](CHANGELOG.md)。

| 平台 | 下载文件 | 安装方式 |
| --- | --- | --- |
| Windows 10 1903+ / Windows 11，x64 | [安装版 EXE](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-x64.exe) | 运行安装程序，按向导安装 |
| Windows 10 1903+ / Windows 11，x64 | [便携版 ZIP](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-x64.zip) | 完整解压到可写目录，运行 `Tigerest Theater.exe` |
| macOS 26+，Apple Silicon（M 系列） | [DMG 安装包](https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.0.18/TigerestTheater-2.0.18-arm64.dmg) | 打开 DMG，将应用拖入「应用程序」 |

想试用 Mac 内置 AI 补帧，可下载 [v2.1.0 Mac 预览版](https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.1.0)。

安装包已包含所需组件，无需另装 MPV。Mac 版目前支持 M 系列芯片。需要核验下载文件时，可使用发布页中的 SHA-256 校验文件。

## 第一次使用

首次启动时，根据使用的服务器选择入口：

### 连接大河李斯特专属 EMBY 服务器

选择「大河李斯特专属 EMBY」，连接后使用服务器账号登录。访问权限与开通说明详见 B站充电页面。

### 连接自建 EMBY 服务器

选择「自建 EMBY」，填写服务器地址，例如：

```text
http://192.168.1.100:8096
https://emby.example.com
https://example.com/emby
```

请使用当前电脑能够访问的完整地址，保留需要的端口和路径。连接后登录服务器账号即可。

客户端会记住已连接的服务器。需要更换时，可在设置中使用「重置已保存的服务器地址」。

## 主要功能

- **媒体库与播放：** 浏览、搜索 Emby 媒体库，使用 MPV 播放视频，切换音轨和字幕，并同步观看进度。
- **弹幕：** 支持匹配、搜索和加载弹幕，可调整字号、透明度、速度与显示区域。使用内置弹幕服务时，搜索和匹配信息会发送至该服务。
- **画质预设：** 提供默认、真人影视和激进测试三档预设，可在播放菜单中选择，或通过 `Alt+1`～`Alt+3` 切换。
- **Mac AI 补帧（v2.1.0 预览版）：** M 系列 Mac 可将最高 1080p、30 fps 的 SDR 恒定帧率视频补至两倍帧率，组件和模型随包提供。
- **MPV 配置：** 可直接使用大河内置配置，也可切换到已有的系统 MPV 配置。
- **下载与离线：** 支持下载任务的暂停、恢复和删除；下载完成后，可从「打开离线媒体」进入播放。下载功能需服务器允许。
- **独立配置档：** 可分别保存不同的设置和离线内容。

## 更新与常见问题

**如何更新？** 安装版可在退出客户端后覆盖安装。便携版请先备份原目录内的 `data`，完整解压新版，再保留或迁移该数据目录；不要只复制 EXE。macOS 退出应用后替换「应用程序」中的旧版本。

**Mac 提示无法打开？** Mac 版尚未经过 Apple 公证。确认安装包来自本项目发布页后，可在「系统设置 → 隐私与安全性」中允许打开。

**连接不上服务器？** 先在当前电脑的浏览器中确认服务器地址可用，并检查协议、端口和路径是否填写完整。仍无法连接时，请保留界面上的错误提示，方便反馈排查。

**Windows 媒体库画面异常？** 完全退出应用后，可尝试用 `"Tigerest Theater.exe" --disable-gpu` 启动。该选项关闭网页界面的 GPU 加速，不影响视频硬解设置。

**在哪里调整播放与弹幕设置？** 使用主页面的「MPV 设置」及视频播放菜单。

**如何开启 Mac 内置补帧？** v2.1.0 预览版在视频设置中提供「AI 补帧（RIFE）」，默认关闭，开启后重新打开视频。需使用内置播放配置；HDR、4K、变帧率及色彩信息不完整的视频保持原帧播放，性能不足时也会自动关闭当前视频的补帧。

**如何使用 SVP 补帧？** 先启动 SVP，再打开客户端，将「硬件解码方式」设为「硬解后复制回显」。Mac 用户需先按 [SVP 官方指南](https://www.svp-team.com/docs/mac/)安装其 mpv 组件，并退出其他正在使用 SVP 的播放器。

遇到其他问题，可提交 [GitHub Issue](https://github.com/Tigerest/Tigerest-Theater/issues)，附上系统、客户端版本、错误提示及复现步骤。截图和日志中请去掉账号、密码及访问令牌。

## 构建

- Windows：参见 [`dev/windows/README.md`](dev/windows/README.md)。
- macOS：参见 [`dev/macos/README.md`](dev/macos/README.md)。

本项目是非官方 Emby 客户端，与 Emby LLC 无隶属关系，不提供服务器或影视资源。第三方组件许可见源码树和安装包内对应文件。
