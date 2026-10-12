# 头像、密码与登录限制增量验证

日期：2026-10-13。依据用户交接 `X:/FRONTEND-AVATAR-PASSWORD-2026-10-13.md`。在已有 shared-danmaku-client 独立工作区继续实现，保留前次公共评论、共享绑定和音量修复。未修改安装版及其设置，未合并 PR #5，未发布正式版本。

## 实现

- 能力接口有新策略时注册/改密使用 8–128 个 Unicode 码点，旁边直接显示范围与稳定帮助文字；没有新策略时保持 12–128。允许中文、emoji 和普通空格，不裁剪/归一化密码，拒绝控制字符；已有密码登录不套用注册限制。
- 外服未登录评论账号时不请求受限列表，隐藏评论、回复预览和旧图片。大河按可信 GUID 自动交换。最终 401（包括直接会话续期失败）清除身份；退出 Emby 开始时立即屏蔽旧会话，后台轮询不能把它恢复。
- Windows/Android 原生桥从当前 Emby 读取经过用户 ID 验证的本人资料与缩略图，生成静态 PNG（至多 128×128、256 KiB），按实际 PNG 字节计算 SHA-256。确认资料没有头像才返回 null；超时、拒绝、404、重定向和解码失败均为未知，不清除旧图。
- 旧服务不附加 avatarHash，不上传；大河用户不在客户端抓取/上传。外服每次评论/回复检查来源，成功后按 avatarSync 上传。未知评论结果重试保留 UUID 和最初头像快照；头像失败不能使成功评论变成失败。用户可单独重试头像，沿用原字节/版本。
- 409 丢弃过期上传，读取本人资料，不循环强制覆盖；迟到的资料结果也不能覆盖更新的任务。429 仅限制头像重试，不阻塞评论到相同期限。切换账号取消来源和上传任务。
- 详情主评论、回复预览/列表、个人发言、消息及消息原文预览使用中央头像的认证 Blob。v2 用评论 Bearer，v1 保留原 Emby 头，URL 不含令牌。账号切换/关闭撤销对象 URL，迟到图片不会复活；图片 404 或解码失败显示默认字，刷新暂时失败则保留已显示内容。

## 线上状态与测试边界

本次再次匿名读取线上 `/community/v2/capabilities`，得到 `enabled=true`、`registrationEnabled=true`，`passwordPolicy`、`avatarPolicy` 均缺失。**候选后端尚未部署，线上仍采用 12 位密码下限；不能将 fixture 中 8 位注册成功描述为生产已可用。**

没有创建生产测试账号、发送生产测试评论或修改任何生产头像。本次未验证另一公网出口、真实 Emby 媒体播放、Android 实机图片解码、macOS 构建/Keychain。原生本地 HTTP fixture 与实际生产 API 分开记录。

## 验证结果

所有 Windows 原生/界面检查在同一 PowerShell 调用中先加载 `dev/windows/Enter-TestEnvironment.ps1`；使用隔离配置。独立包启动还会清除开发工具链/Qt 环境覆盖。

| 检查 | 结果 |
|---|---|
| Node 协议及审查回归 | 63/63，通过；`build/avatar-final-node.log` |
| Qt 原生头像桥接 | 7/7，通过；实际本地 HTTP 图片读取、用户身份、PNG/尺寸/hash/确定性、无图与失败、大小与取消；`build/avatar-bridge-green.txt` |
| QtWebEngine 新增 UI | 新旧密码规则、emoji 计数、8 位注册/改密、旧密码登录、各处头像、独立重试、503 保留、坏 PNG 回退、退出与迟到图片清理通过 |
| Android JVM | 116 tests，0 failure/error/skip |
| Android lint/debug | 构建成功，0 errors / 43 warnings；新增两条为 Bitmap KTX 写法建议；20 个原生库符合 16KB 对齐 |
| Windows 全量 CTest | 80/80 目标通过，300.47 秒；`build/avatar-final-ctest.log` |
| Windows 独立包启动 | 清除开发工具链/Qt 环境覆盖后通过；实际内嵌头像模块、原生接口、密码校验、WinCred 写入/读取/删除与请求限制通过；`build/avatar-portable-smoke.log` |
| 包验证 | Windows 暂存及 ZIP 1528 文件、Android APK 204 文件通过私有路径和实际令牌字节扫描；ZIP 全文件与暂存 SHA256 一致；APK 内 8 份 community 脚本与源码逐字节一致 |

新协议先记录 10 个缺失行为失败，再实现通过。独立代码审查发现并修复了三个实质问题：迟到 409 资料响应覆盖新图、身份交换 401 残留身份、退出 Emby 时消息同步恢复旧账号。每项均有先失败再通过的回归。共享头像解码失败的界面回退也记录先失败再通过。最终独立审查无未解决阻断项；其只读 Node 检查 43/43 通过。

80 个 CTest 目标通过不等于所有 Qt 子用例都执行：5 个环境限定子用例跳过，分别为 WindowManager 的 3 项独占指针检查、WindowChrome 的 1 项工作区条件不满足的无边框最大化检查、RifePlayerStartup 的 1 项需已验证私有运行库的实探。完整记录在 `build/Testing/Temporary/LastTest.log`。安装暂存退出码为 0；部署工具仍提示可选 NMEA 插件缺少 Qt6SerialPort，最终独立便携包启动通过。

## 交付

Windows 便携预览：`build/TigerestTheater-2.5.3-community-avatar-preview-x64.zip`，314523361 字节。

SHA256：`1C339A5DAE99CC7EF7397103F3F33068649E429C46736682DEC7AB947AAA513B`。

Android 调试包：`android/app/build/outputs/apk/debug/app-debug.apk`，88972547 字节。

SHA256：`3EF4C46EF02C99B56FAACA6FEAD9718F18806D4D2279DD8351ACE834EC283362`。

验证明细：`build/avatar-package-verification.json`。旧 Windows 包保留。当前代码保持未提交，PR #5 的改动不包含在此包；详见 [PR #5 审查](2026-10-13-pr5-review.md)。

自动审批以 `blocked by policy` 拒绝删除一次失败测试启动留下的临时目录 `C:/Users/59890/AppData/Local/Temp/tigerest-comments-e382g2`，未给出更具体理由。该目录保留，未绕过限制，不在发行包内，也未改动安装版设置。
