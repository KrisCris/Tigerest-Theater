# 共享弹幕客户端验证（2026-10-11）

## 交付范围

基于主分支 `908159bc1898fea1fef74fa6f68bd0c8858b40a9` 的现有桌面共享弹幕接入，修复未配置写入权限时的反馈、429 后旧接口/目录搜索绕过等待、被拒绝的手动选择提前改写当前标题、空弹幕误报已加载。NAS 的 LAN/DDNS 地址共用冷却，第三方自动匹配仍可继续。没有修改后端或 Android。

用户确认正式发行版应让所有已登录用户默认保存。已交付 [后端会话授权要求](../backend-danmaku-session-auth.md)，并复制到 `X:/CLIENT-MAPPING-AUTH-REQUIREMENTS.md`；两份 SHA256 一致。新授权还没有部署，本预览仍实现当前 v1，普通用户不能仅凭登录写入。

## 真实生产接口与 Lua 联调

读取用户提供的独立凭据文件，仅在 `TigerestDanmakuClientValidation/20261011/private/` 的私有配置中转换为授权头文件，ACL 仅允许当前 Windows 用户及 SYSTEM。未修改已安装播放器及默认配置，真实凭据不进入测试 fixture、源码、MPV 公开属性、命令参数或发行包。

先通过生产作品目录确认作品 17617 的第 3/4 集 ID 分别为 176170003/176170004。加载实际生产 Lua 脚本和 libmpv，播放生成的 120 秒 MP4，触发真实 `load-danmaku` 手动事件，然后切换原视频元数据为第 4 集并重新播放：

- 原视频《葬送的芙莉莲》S01E03 手动选择第 3 集，响应 origin=manual，现有解析器加载 6434 条弹幕。
- 切换为 S01E04，响应 origin=shared，加载“第4话 灵魂长眠之地”的 6889 条弹幕。
- 请求观察记录为首次读取、手动保存、下一集读取，均为 `POST /api/tigerest/v1/danmaku`，没有额外 `/api/v2/comment/` 下载。
- 独立、不带认证头的 HTTP 读取随后确认 matched=true、origin=shared、episodeId=176170004、anchorSourceEpisode=3，原始响应 count=6922。这证明规则可由另一个无授权调用复用。

这验证当前 v1 的生产保存、持久绑定读取和实际 Lua/HTTP 连接；视频是生成的测试媒体，并非真实 Emby 剧集的交互播放。不能把这项验证当作普通用户会话授权已实现。

初次无容器时长的 lavfi 测试流完成了手动保存，但无法触发自动加载的时长资格检查；改用有真实容器时长的 MP4 后完整链路通过，没有为此修改产品代码。

## 自动化与构建

Windows 原生构建及部署成功。每次原生执行前在同一个 PowerShell 中加载 `dev/windows/Enter-TestEnvironment.ps1`，运行库、RIFE bridge 和 Windows/offscreen Qt 平台预检通过。

真实 Lua 入口 fixture 的 73 个用例通过，其中本次新增 6 个回归均先复现失败再通过修复。独立复查已通过。

完整 CTest 首轮运行 74 个目标：73 个通过，1 个路由 fixture 因单独加载 API 却遗漏 mapping 模块而失败。补齐真实模块加载后该目标重跑通过；完整运行后再执行 `--rerun-failed` 为 1/1 通过。完整日志与修复后的重测日志分别保存在 `build/ctest-shared-mapping.txt`、`build/ctest-shared-mapping-retest.txt`。

明确跳过的子用例共 5 个：WindowManager 的 3 个独占桌面鼠标集成检查、WindowChrome 的 1 个工作区条件不满足的无边框最大化检查，以及 RifePlayerStartup 的 1 个需要验证过的私有运行库的真实探测。这些子用例没有通过执行验证。

部署工具还提示可选 NMEA 定位插件找不到 Qt6SerialPort；部署本身退出码为 0。播放器启动验证需另见下方发行包记录。

## 发行包记录

Windows portable ZIP 已生成：`build/TigerestTheater-2.5.3-x64.zip`（当前 v1 预览，并非正式发布）。暂存目录 1526 个文件、最终 ZIP 1528 个文件均已逐项扫描，未包含私有凭据文件或实际令牌的 UTF-8/UTF-16 字节。

交付别名为 `build/TigerestTheater-2.5.3-shared-mapping-preview-x64.zip`，大小 314467008 字节，SHA256 为 `B69DA1AD7EB89C6440B7FF349C79D1FD9FFC14E3D4DE3464D44067B45AB295EA`。

`tests/smoke_windows_bundle.cjs` 使用独立临时配置启动 portable 暂存包；完成预检后清除工具链 PATH 与 Qt 环境覆盖，仅靠包内运行库启动并创建 WebEngine 页面，退出码为 0。启动检查不代替真实 Emby 媒体播放或新会话授权验收。

## 临时凭据清理状态

自动审批拦截了临时授权文件清理，返回 `blocked by policy`，未提供具体原因。该受限权限的联调授权文件仍保留在独立私有配置中；没有删除用户原始凭据，也没有将它加入发行包。
