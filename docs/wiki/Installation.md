# 安装与更新

## 选择正确的包

从[正式发行页](https://github.com/Tigerest/Tigerest-Theater/releases/latest)下载，基础包已经包含 MPV 与运行库。下面以 2.6.0 的文件名示例说明；安装步骤也适用于后续同类正式包。

| 设备 | 包名 | 最低要求 |
| --- | --- | --- |
| Windows 安装版 | TigerestTheater-2.6.0-x64.exe | Windows 10 1903+ 或 Windows 11，x64 |
| Windows 便携版 | TigerestTheater-2.6.0-x64.zip | 同上 |
| Android | TigerestTheater-2.6.0-android.apk | Android 15+，arm64-v8a / x86_64 |
| Apple Silicon Mac | TigerestTheater-2.6.0-arm64.dmg | macOS 26+，M 系列 |

Windows 安装版适合日常使用，由安装器管理程序目录；便携版适合把程序与配置放在同一个文件夹。Mac 正式附件目前仅提供 Apple Silicon 版本。Android 的系统版本和处理器架构必须同时满足要求。

## Windows 安装版

1. 下载 EXE。升级时先退出运行中的客户端；若启用了系统托盘，还要从托盘退出。
2. 运行安装器并按向导完成安装，升级时使用原来的安装位置。
3. 启动客户端，连接 Emby 服务器。首次安装不需要另外下载 MPV、Python 或 CUDA Toolkit。
4. NVIDIA RIFE 扩展按需要另行安装，见 [RIFE 教程](https://github.com/Tigerest/Tigerest-Theater/wiki/RIFE)。

安装包目前没有 Authenticode 签名。遇到系统来源提示时，先核对下载来自本项目发行页以及校验值，再决定是否继续。

## Windows 便携版

1. 把 ZIP 完整解压到可写目录，运行其中的 `Tigerest Theater.exe`。
2. 保留随包的子目录和运行库。只取出一个 EXE 无法构成完整客户端。
3. 更新前完全退出，备份旧目录中的 `data`。
4. 将新版完整解压到新文件夹，再把原有 `data` 放回新版目录；确认正常后再自行处理旧程序目录。

`data` 包含配置档及其数据。直接删除它会影响登录、设置、缓存、离线文件或已有扩展；更新不需要清空它。不同位置的便携副本通常各自使用本地数据，不要把它们当成同一个配置。

## macOS

1. 下载 arm64 DMG，打开后将应用拖入「应用程序」。
2. 更新前退出旧应用，再替换「应用程序」中的原应用。
3. 从「应用程序」启动。当前使用 ad-hoc 签名，尚未经过 Apple 公证；确认来源后，如被系统拦截，可在「系统设置 → 隐私与安全性」按提示允许打开。
4. RIFE 模型和插件随包提供，无需 Windows 的 NVIDIA 扩展。

不要把 Windows 扩展 ZIP 导入 Mac。Mac 的补帧范围与 Windows 不同，详见 [RIFE](https://github.com/Tigerest/Tigerest-Theater/wiki/RIFE)。

## Android

1. 下载 APK，通过系统安装器安装“大河影院”。
2. 系统可能要求允许当前浏览器或文件管理器安装应用，按系统页面授权。
3. 升级时使用本项目同签名正式 APK 覆盖安装，可保留应用数据。
4. 如果系统提示签名冲突，先确认当前装的是正式版还是调试版、文件是否来自本项目。不要为了尝试更新立即卸载已有应用，卸载可能清除数据。

应用内更新交给系统安装器时，需要允许“大河影院”安装应用。取消系统安装后仍可返回客户端重试。

## 应用内更新

每次启动会在后台检查新正式版。只有版本更高且包含对应平台安装包时，右上角更新图标才显示红点；不会自动弹出更新窗口。

点击更新图标可查看版本说明，并选择「立即更新」「稍后」或「跳过此版本」。在「客户端」设置中可以关闭「启动时检查更新」，或点击「检查客户端更新」；手动检查也会包含此前跳过的版本。

下载支持暂停和继续；退出后再次检查同一版本可以续传。网络中断会自动重连，连续多次没有新进度后才显示失败。服务器文件变化、无法续传或缓存损坏时，客户端会重新下载。

下载完成后会核验大小和 SHA-256。Windows 安装版打开升级向导；便携版打开 ZIP 后仍需退出并替换程序；Mac 打开 DMG 后替换应用；Android 打开系统安装器。完成下载不等于安装完成。

早期 Windows 版本的内置更新若始终下载失败，请手动下载当前安装包并覆盖安装一次。暂时无法检查更新不会阻止浏览或播放。

## 核对 SHA-256

发行页提供同版本的 `TigerestTheater-2.6.0-SHA256SUMS.txt`。先找到文件名对应的摘要，再与本机结果对照。

Windows PowerShell 示例：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'C:\Downloads\TigerestTheater-2.6.0-x64.exe'
```

macOS 终端示例：

```sh
shasum -a 256 ~/Downloads/TigerestTheater-2.6.0-arm64.dmg
```

摘要应完全相同，大小写不影响比较。如果不同，重新下载该文件；不要使用校验失败的包继续更新。

下一步：[连接服务器](https://github.com/Tigerest/Tigerest-Theater/wiki/Server)。
