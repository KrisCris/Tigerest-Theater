# 公共评论 v2、共享弹幕会话授权与音量记忆验证

日期：2026-10-12。基于 `908159bc1898fea1fef74fa6f68bd0c8858b40a9`，用户已批准前端设计并要求直接实现、验证。代码保留在独立工作区，未提交、推送或发布正式版本；安装版及其设置未改动。

后续 2026-10-13 头像、动态密码策略与登录限制增量见 [新验证记录](2026-10-13-community-avatar-password-validation.md)。本文保留当时结果及历史包哈希。

## 实现结果

- 大河 Emby 登录自动交换公共评论会话；共享弹幕手动保存使用当前 Emby 的三个授权头，无需发行包附带管理员 JSON。独立评论 Bearer 不参与弹幕或私人 v1 请求。
- 外服使用独立评论账号，提供注册、登录、退出、修改密码；外服 Emby token 不发送到大河。Windows 使用 Credential Manager，macOS 使用 Keychain，Android 使用 Keystore 加密数据；保存失败明确降级为本次内存登录。
- 默认公共评论，大河保留本服评论与私人报错。大河消息采用 v1 统一列表，外服采用 v2，避免重复通知；公共界面不显示管理操作。公共头像为默认头像。
- 影片/剧集通过可靠 TMDB 标识关联，单集显式读取 Emby `DisplayOrder`，拒绝未知、DVD、合并集。季 0 支持。消息跳转只接受本地媒体库的唯一匹配；无法定位时仍打开公共讨论。
- 评论刷新单飞、旋转后安全保存、丢失刷新响应不重用旧 refresh；账号切换取消旧响应、草稿和待发身份。相同发送在通道/范围往返、刷新后仍复用 UUID；503 保留成功加载的内容。
- 映射能力查询失败后有 30 秒重试间隔。只有能力接口 404、可信大河身份和已有私有授权同时满足，才启用旧令牌兼容；401/403/503 不触发回退。Android 移除旧令牌配置菜单，新用户无需配置。
- 修复音量的 0～1 与 0～100 单位混用；退出后保存正确值，保留合法静音。详见 [音量验证](2026-10-12-volume-persistence-validation.md)。

## 自动化及独立审查

所有原生测试在同一次 PowerShell 调用中先加载 `dev/windows/Enter-TestEnvironment.ps1`，运行库及 Windows/offscreen Qt 插件预检通过。界面及播放均使用隔离配置。

| 检查 | 结果与证据 |
|---|---|
| Windows 构建、安装暂存 | 成功；`build/community-release-build.log`、`community-final-install.log` |
| 最终 Windows CTest | 79/79 目标通过，289.30 秒；`build/community-final-ctest.log` |
| Node 协议及审查回归 | 42/42，通过；可信身份、刷新、凭据隔离、UUID、作者切换、DisplayOrder 等 |
| 真实 WebEngine 界面 fixture | 外服登录、账号 A → 从消息退出 → B、详情身份和草稿同步、503 保留内容、公共话题降级查看通过 |
| 原生安全存储 | 真实 Windows Credential Manager 写入、读取、删除；限定目的地/授权头策略通过 |
| 旧映射兼容 | 原生桥接 4 passed；Lua 元数据/运行时目标 6 passed；能力状态、外服隔离、注入/超长旧文件、原文件保留均覆盖 |
| Android | JVM 114 tests、0 failure/error/skip；Lint 0 errors、41 warnings；debug APK 构建成功，20 个原生库符合 16KB 对齐 |

一位新审查者对整体变更完成最终审查，发现的六项实质问题均修复：跨视图账号切换、同媒体私人消息定位、通道往返丢失发送 UUID、能力 503 后不重试、刷新失败清空评论、旧令牌兼容缺失。前五项新回归先显示 0/5 通过，修复后 5/5；旧令牌原生/Lua/Kotlin 也记录先失败后通过。另补充迟到发送结果不得影响新作者、隐藏通道旧草稿清理、安全存储恢复事件等边界检查。未以重复审查替代测试。

CTest 目标通过不代表所有 Qt 子用例执行：5 个子用例明确跳过，分别为 WindowManager 的 3 个需独占桌面指针的检查、WindowChrome 的 1 个不满足屏幕工作区条件的无边框最大化检查、RifePlayerStartup 的 1 个需要已验证私有运行库的实探。日志保存在 `build/Testing/Temporary/LastTest.log`。

真实 Emby 查询确认：仅请求 `Fields=ProviderIds` 不返回集序，显式请求 `Fields=ProviderIds,DisplayOrder` 返回 `Aired`。因此没有把缺失字段默认当作 aired。后端 v2 消息中的媒体键本身是规范播出键，允许省略 order，与未确认的 Emby 元数据分开处理。

## 真实生产 API 与播放器联调

以下不使用模拟后端，但没有向生产公共评论区发送测试文字、提交测试报错或标记消息已读。

1. 使用已有合法 Emby 会话，生产 `/auth/emby`、`/me`、`/auth/logout` 返回 200，公共作者存在，`isCommentAdmin=false`。没有使用管理员 mapping token；该结果不等同于断言 Emby 账号本身没有任何管理员权限。
2. 最终 Windows 程序的真实 WebEngine、原生网络桥接和 Credential Manager 再次完成能力发现、自动交换、`/me`、映射会话建立和评论凭据清理。结果：`trusted=true, hasAuthor=true, commentAdmin=false, secureStore=true, mappingSession=true, secureCredentialsRemoved=true`。日志：`build/live-community-native-result.log`。
3. 实际 Lua 与 libmpv 播放生成的 120 秒 MP4，按《葬送的芙莉莲》S01E03 手动选择 176170003，通过三头 Emby 会话保存，解析 6432 条弹幕；切到 S01E04 后匿名共享读取返回 `origin=shared`、解析 6887 条。只有首次读取、手动保存、下一集读取三次映射 POST，没有额外旧接口下载。日志：`build/live-community-mapping-result.txt`。这重申已有正确绑定，没有写入任意错误校准。
4. 音量通过真实窗口关闭按钮和 Alt+F4 四次正常退出（exit 0）：首次 100，重启 100；修改为 37 后重启 37；主动 0 后重启仍为 0。原生、网页与保存值一致。旧版已错误保存的 0 与主动静音无法区分，保留该值；手动调整一次后正常记忆。

这些验证没有覆盖真实 Emby 剧集的完整交互播放、生产双账号互相发评/回复、另一公网出口。原生桥接实际联网成功不能当作另一公网的验证。Android 仅完成构建、JVM 和协议/共享界面代码覆盖；本机模拟器缺少硬件加速驱动，未修改连接中的实体设备。macOS 为源代码适配，未进行 Mac 构建或 Keychain 实机验收。

## 预览包

Windows：`build/TigerestTheater-2.5.3-community-v2-preview-x64.zip`，314537332 字节。

SHA256：`281B4DD6889443EA5D6C47C67D00C9B43E6A655CFFDCA6F5518E878BDE42FAA3`。

Android 调试包：`android/app/build/outputs/apk/debug/app-debug.apk`，88961353 字节。

SHA256：`9BEFE5F5A0703F32CEAA3577CA3A38CBE5A79B377F52CA15FB70B19B39078420`。

Windows 暂存目录及 ZIP 各 1528 个文件逐项检查，不含私有凭据路径、当前真实 Emby token 或旧管理员 token 的 UTF-8/UTF-16 字节；最终 Android APK 的 203 个文件也通过同类检查。临时 API 联调脚本及账号文件不进入包。另逐一核对 ZIP 与暂存目录的 1528 个文件 SHA256，一致。

完成运行库预检后清除工具链 PATH 和 Qt 环境覆盖，只保留 Windows 系统目录，以隔离配置启动 portable 暂存程序，成功创建 WebEngine 页面，测试退出码为 0。记录：`build/community-zip-smoke.log`。此项为包的独立启动检查，不替代媒体播放验收。

部署工具存在可选 NMEA 插件缺少 Qt6SerialPort 的警告，部署退出码为 0；正式包启动按独立运行库检查。正式发布和自动更新版本未改动。

## 临时授权文件

真实 Lua 联调使用受限权限的独立目录。自动审批拒绝删除 `%LOCALAPPDATA%/TigerestCommunityLiveValidation/20261012-session/private/emby-session.headers`，仅返回 `blocked by policy`，未提供具体原因；未绕过该拒绝。文件仍保留，ACL 限当前用户和 SYSTEM，不在发行包内。前次 2026-10-11 的同类受限清理也未重试。上述限制不影响最终原生桥接测试的评论凭据正常退出清理。

## 2026-10-13 注册校验提示补充

用户截图显示合法用户名/昵称及较短的密码。使用 9 字符的合成密码复现：客户端原本把密码长度、用户名和昵称错误统一显示成“提交格式无效”，且该状态文字覆盖了初始密码要求。请求在本地被拒绝，没有到达注册服务。

现改为分别提示字段错误；短密码显示“密码需为 12–128 个字符（当前 9 个）”，密码要求永久保留在注册密码输入框旁。后端约束保持原样；密码仍按 Unicode 码点计数，不截断、不规范化，不把密码原文放入错误消息。当前旧包使用合格长度的密码仍可注册。

验证：Node 44/44；社区相关 CTest 10/10（36.20 秒），包含真实 WebEngine 注册失败→修正→成功和账号切换。新回归在旧代码及旧暂存程序上均失败，修复后通过。新 portable 在清除开发工具链与 Qt 环境覆盖后，实际内嵌注册校验、凭据读写清理及请求策略均通过。Android JVM、Lint、debug 构建及 16KB 校验成功，APK 中两份变更脚本与源码逐字节一致。未向生产服务器创建测试账号。本次没有重跑与提示修改无关的全部 Windows 原生测试，前次 79/79 记录保留在上文。

更新后的 Windows 包：`build/TigerestTheater-2.5.3-community-registration-fix-x64.zip`，314506509 字节，SHA256 `27717F2F9528C6B5D40E89BFDFB965EAC11E3A17EAD6D6AAC24C9E1C87E7B61A`。1528 个 ZIP 文件通过私有凭据扫描；ZIP 内程序与独立启动验证的程序哈希一致，前次 ZIP 保留。

同路径 Android debug APK 已更新，当前 SHA256 为 `EB1664748532750E4A211EDD2A52E49E9E77931038CAB307F0A698B73BF1122E`。Android/macOS 实机覆盖限制仍与前述一致。
