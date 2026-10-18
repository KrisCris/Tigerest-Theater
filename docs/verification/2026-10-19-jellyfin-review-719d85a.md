# Jellyfin 2.9.0 首轮审查问题

首轮待测提交：`719d85a`（基线 `2f5e06c`）。仅本地工作，未推送。2026-10-19，Codex 审查。Claude 已在 `6873c07` 修复两项；JF-01 已通过真实 Windows＋12.2 设置复测，JF-02 静态复核通过，Swift 执行仍受工具链限制。

## JF-01：Jellyfin 客户端设置缺少媒体库客户端（P2）

复现：登录任意 Jellyfin，打开客户端设置 → 首页 → 首页媒体夹。实际显示「登录服务器后，可以在这里选择首页显示的媒体夹」，无法选择、隐藏或排序库；预期显示当前已登录账号可访问的库。

根因：`native/nativeshell.js` 的 `openTigerestSettings` 在 Jellyfin 下走 `mountTigerestSettings(null, section)`，未传 `apiProvider`。`createHomeLibraryControl` 从该提供者取客户端；即使网页已有已登录 `ApiClient`，仍会进入未登录分支。Emby 的路由控制器已有提供者，Jellyfin 插件未连接该依赖。

建议：给 Jellyfin 设置弹窗提供当前会话的 API 客户端，处理切服与退出，不缓存旧账号实例。加入实际弹窗入口到媒体库控件的回归测试；单测插件注册不能覆盖此处。

复测：`6873c07` 中 `currentSessionApiClient()` 每次向 Jellyfin 连接管理器取当前账号，弹窗传入该提供者。重新构建的 Windows 客户端登录真实 12.2 后，弹窗列出两个媒体库及收藏；证据 `6873c07-web-12.2-settings.json`。新增 A/B/退出测试存在下文独立的 WebEngine fixture 隔离问题，不影响此真实入口结论。

## JF-02：旧 Apple TV Jellyfin 会话未迁移服务类型（P2）

复现前提：2.8.1 已登录 Jellyfin 10.x，保存会话含 `serverID`、不含新字段 `serverKind`；升级应用至 2.9.0、服务器至默认禁用旧鉴权的 Jellyfin 12。重启恢复会话后请求使用旧鉴权，无法正常恢复媒体库。

根因：`apple/TV/TVAppModel.swift` 的 `start()` 仅当 `saved.serverID == nil` 才探测服务器。基线登录本来就保存 `serverID`，因此旧会话跳过迁移，`EmbySession.kind` 回退 `.emby`，客户端发送 `X-Emby-*`。真实 12.2 测试：相同测试账号的现代 Authorization 请求 `/UserViews` 返回 200，旧 `X-Emby-Token` 或 `api_key` 返回 401。

建议：恢复时探测缺少服务类型的会话并持久化迁移结果，保留已有凭据、服务器身份和请求失效检查；不把暂时网络故障持久化为错误产品类型。覆盖已有 serverID、缺少 kind 的旧 JSON 会话。

复核：`6873c07` 改为缺少 serverID 或 serverKind 任一字段都探测，补字段时保留已有身份及凭据，保存前检查请求代际，失败不保存。已新增迁移、失败、途中退出用例；本机没有 Swift/Xcode，尚未执行这些测试或 TV 真机验证。

## JF-03：新增设置回归未隔离原生社区插件（测试，P2）

`6873c07` 的 `tests/test_settings_ui.cjs:168` 在 WebEngine 模式创建 Jellyfin 插件时失败。fixture 已将 `window.api` 替换为只含 player/settings 的边界对象，原生注入仍提供 `_communityPlugin`；构造器实际进入 CommunityPlugin → Account → CommunityBridge，读取缺失的 `api.system.communityResponse`，报 TypeError。Chrome 没有该预注入插件，故 Chrome 通过未覆盖此差异。

独立暂存客户端复现日志：`settings-trace-6873c07.log`。预期在设置测试边界隔离不相关的社区/一起看构造器，保留账号 A、账号 B、退出三组实际弹窗断言；不为 fixture 更改产品行为。已于 03:55:03 JST 直接交回原 Claude 会话修复。

03:56 Claude 交付 `dffa1bd23df2c5b752e97b94ecc29780c1cb8767`，仅修改此测试，在构造 Jellyfin 插件时临时清除不相关插件并在 finally 恢复。A/B/退出断言保留。Codex 随后重新运行 CTest 的 settings_webengine 与 home_gallery_webengine，两目标均通过，18.73 秒；`ctest-dffa1bd.log`。JF-03 已关闭，图库首次动画超时未再复现，没有修改产品动画。

## 已撤回的推断与证据边界

- 不将过期服务器版本导致的 `PresentationUniqueKey` 请求列为已证实故障：五个真实服务器均对测试中的无效 Fields 返回 200。接口报告已区分枚举定义与具体 HTTP 行为。
- 媒体流端点可以独立采用不同授权规则；12.2 本地测试中直接流 URL 无凭据也返回 206，因此流读取成功不能单独证明媒体 token 校验成功。鉴权差异使用 `/UserViews` 验证。
- 没有 Apple 工具链与设备时，Swift 静态审查和 HTTP 证据不能代替 Swift 编译及 TV 真机验收。

本轮脱敏测试证据与隔离构建目录：`D:/CodexDeps/TigerestTheater/verification/jellyfin-290/`。其中 `*.private.json` 仅为本轮临时服务器生成的测试凭据，不提交仓库。完整结果继续记录在主验收文档。
