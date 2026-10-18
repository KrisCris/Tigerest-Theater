# Jellyfin 2.9.0 接口适配报告

2026-10-19。实现基线为 `2f5e06c97bd6c9cd4cdc1f5b4fe84c3813a69857`，工作分支为 `claude/jellyfin-2.9.0`。本文是源码和官方协议核对结果，不代表客户端已经通过 Jellyfin 实测。代码实现由 Claude 负责；实现后的审查、服务器验证和客户端测试由 Codex 负责。

适配重点是鉴权、字段枚举、URL 拼接以及网页扩展注册。Windows、Mac、Android、iPad 共用网页脚本；Apple TV 使用独立的 Swift HTTP 客户端，必须单独适配。只让服务器选择页接受 Jellyfin 地址，不足以完成兼容。

## 已核实的协议差异

### 鉴权与地址前缀

- Jellyfin 12 默认停用旧鉴权。JSON 请求使用 `Authorization: MediaBrowser Client="…", Device="…", DeviceId="…", Version="…", Token="…"`；登录前不带 Token。无法设置请求头的图片、字幕、媒体 URL 使用 `ApiKey`。`X-Emby-Token`、`X-Emby-Authorization` 和带下划线的 `api_key` 受旧鉴权开关控制，不能作为新实现的依赖。[12.2 鉴权源码](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Server.Implementations/Security/AuthorizationContext.cs)、[默认关闭旧鉴权的变更](https://github.com/jellyfin/jellyfin/pull/15559)
- Jellyfin 12 移除了服务器内建的 `/emby/*`、`/mediabrowser/*` 兼容前缀。它们与用户配置的反向代理 Base URL 是两回事：用户输入 `https://example.com/jellyfin`，请求仍须保留 `/jellyfin`；用户确实配置了 `/emby` 作为 Base URL 时也不能盲目删除。只去掉客户端自行添加的旧 API 前缀。[12.0 说明](https://jellyfin.org/posts/jellyfin-release-12.0/)、[Base URL 说明](https://jellyfin.org/docs/general/post-install/networking/#base-url)
- `/Users/{userId}/…` 并非在 12.2 全部删除。源码仍保留多条带 `Obsolete`、`IgnoreApi` 标记的兼容路由。迁移到公开路由是为了去除废弃接口依赖；不要把所有旧路由都记成已实测 404。[ItemsController](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/ItemsController.cs)、[UserLibraryController](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/UserLibraryController.cs)

### 首页字段是单独的兼容问题

本地 `native/homeData.js` 和 `apple/Core/Sources/AppleCore/Emby/EmbyHomeData.swift` 将 Emby 字段列表直接交给接口。Jellyfin 的 `Fields` 是枚举，不等于 JSON 响应中所有属性的名字。

| 字段 | 10.9.11 / 10.10.7 枚举 | 10.11.0 / 10.11.11 / 12.2 枚举 | 实现要求 |
| --- | --- | --- | --- |
| `PresentationUniqueKey` | 有 | 无 | 按版本过滤，或使用各目标版本共有字段；不能要求新版响应总有此字段 |
| `UserDataLastPlayedDate` | 无 | 无 | 不发送此 Fields 值；验收 `UserData.LastPlayedDate` 的实际返回和排序 |
| `PremiereDate`、`CommunityRating` | 无 | 无 | 不因为它们是响应属性就放进 Fields；排序参数另行保留 |
| `SeriesId`、`SeasonId`、`DisplayOrder` | 无 | 无 | Swift 通用字段串也需要处理，不只是首页字段串 |
| `DateCreated`、`Overview`、`Genres`、`PrimaryImageAspectRatio` | 有 | 有 | 是当前首页字段串可用的共同部分 |
| `MediaSources`、`ProviderIds`、`People`、`Studios`、`MediaStreams` | 有 | 有 | 按请求实际需求保留 |

逐标签核对：[10.9.11](https://github.com/jellyfin/jellyfin/blob/v10.9.11/MediaBrowser.Model/Querying/ItemFields.cs)、[10.10.7](https://github.com/jellyfin/jellyfin/blob/v10.10.7/MediaBrowser.Model/Querying/ItemFields.cs)、[10.11.0](https://github.com/jellyfin/jellyfin/blob/v10.11.0/MediaBrowser.Model/Querying/ItemFields.cs)、[10.11.11](https://github.com/jellyfin/jellyfin/blob/v10.11.11/MediaBrowser.Model/Querying/ItemFields.cs)、[12.2](https://github.com/jellyfin/jellyfin/blob/v12.2/MediaBrowser.Model/Querying/ItemFields.cs)。无效枚举参数的具体 HTTP 结果留给真实 API 验证，不把静态检查写成服务器测试。

`IncludeItemTypes` 同样受枚举约束；12.2 有 `AudioBook`，没有本地兜底列表中的 `Game`。检查混合库与收藏夹，不要只测电影、电视剧。[BaseItemKind](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Data/Enums/BaseItemKind.cs)

### 路由映射

以下路径均相对于用户的服务器 Base URL。常用公开替代路由已核对 10.9.11、10.10.7、10.11.0、12.2 的控制器源码；10.11.11 的运行结果与其他版本一起列入待测矩阵。

| 功能 | 基线 Swift 调用 / 网页入口 | Jellyfin 目标 |
| --- | --- | --- |
| 公共信息 | `GET System/Info/Public` | 保留，读取产品、版本、Id；不带用户凭据 |
| 登录 | `POST Users/AuthenticateByName` | 保留请求语义，替换鉴权头；密码只交给所选媒体服务器 |
| 媒体库 | `Users/{u}/Views` / `getUserViews` | 原生请求使用 `UserViews?userId={u}` |
| 条目列表、搜索、收藏、子目录 | `Users/{u}/Items` / `getItems` | 原生请求使用 `Items?userId={u}`，过滤 Fields 和类型枚举 |
| 继续观看 | `Users/{u}/Items/Resume` / `getResumableItems` | 原生请求使用 `UserItems/Resume?userId={u}` |
| 单条目 | `Users/{u}/Items/{id}` / `getItem` | 原生请求使用 `Items/{id}?userId={u}` |
| 剧集与季 | `Shows/{id}/Seasons`、`Shows/{id}/Episodes` | 保留公开路由；验证 UserId、SeasonId、分页与 AdjacentTo |
| 播放协商 | `POST Items/{id}/PlaybackInfo` | 保留 UserId、DeviceProfile、媒体源和续播位置；验证所选源 |
| 播放状态 | `POST Sessions/Playing`、`…/Progress`、`…/Stopped` | 保留会话与媒体源标识；允许合法空响应 |
| 图片 | `Items/{id}/Images/{type}` | 原生 URL 用 ApiKey；网页优先用当前服务的 getImageUrl |
| 视频、外部字幕、离线地址 | PlaybackInfo 返回值 / 本地兜底 | 尊重返回 URL；保留 Base URL，鉴权只给正确服务器 |

路由来源：[10.9.11 Items](https://github.com/jellyfin/jellyfin/blob/v10.9.11/Jellyfin.Api/Controllers/ItemsController.cs)、[10.10.7 Items](https://github.com/jellyfin/jellyfin/blob/v10.10.7/Jellyfin.Api/Controllers/ItemsController.cs)、[10.11.0 Items](https://github.com/jellyfin/jellyfin/blob/v10.11.0/Jellyfin.Api/Controllers/ItemsController.cs)、[12.2 UserViews](https://github.com/jellyfin/jellyfin/blob/v12.2/Jellyfin.Api/Controllers/UserViewsController.cs)。这些映射不要求重写服务器网页自带的 API SDK；共享脚本应优先调用当前网页 SDK。

## 本地调用点与职责

| 调用区域 | 文件与入口 | 实现关注点 |
| --- | --- | --- |
| Qt 连接与注入 | `src/system/SystemComponent.cpp`：`checkServerConnectivity`、`checkServerBase`、脚本列表 | 公共信息验证、代理路径、错误文案、serverKind 加载顺序 |
| Android 连接与注入 | `android/app/src/main/java/top/tigerest/theater/BridgeDispatcher.kt`、`WebHost.kt` | 公共信息与过期请求取消；共享脚本只注入一次 |
| iPad 连接与注入 | `apple/App/AppModel.swift`、`NativeBridge.swift`、`WebHost.swift`；`apple/tools/sync_resources.py` | 相同 Base URL 约定，资源同步和原生桥来源限制 |
| 服务类型 | `native/serverKind.js`，Claude 已开始实现 | 首次冷启动、缓存失效、切服；unknown 不应造成 Emby 改写抢跑 |
| 网页原生壳 | `native/nativeshell.js`、`embycompat.js` | Jellyfin NativeShell 注册与 Emby appStartInfo/模块注册分开验证 |
| 网页播放器 | `native/mpvVideoPlayer.js`、`mpvAudioPlayer.js` | API registry 参数、现有鉴权、图片/字幕 URL、播放器事件与下一集 |
| 离线 | `native/offline.js` | PlaybackInfo 返回 URL 的解析；不向 Jellyfin 自动补 `/emby`；Android 不因本次适配新增下载能力 |
| 首页 | `native/homeData.js`、`homeGallery.js`、`homeBackdrop.js`、`homeMotion.js` | 字段过滤、作品身份回退、分页和排序；注册及 DOM 挂载 |
| 登录与路由 | `native/sessionNavigationPlugin.js` | Emby pageJs/appRouter 注入依赖不可假定在 Jellyfin 相同；退出清理与返回栈 |
| 原生 TV API | `apple/Core/Sources/AppleCore/Emby/EmbyClient.swift` | 会话保存服务类型；迁移旧会话；路由、Fields、鉴权、播放/字幕/图片 URL 一起适配 |
| TV 首页 | `apple/Core/Sources/AppleCore/Emby/EmbyHomeData.swift`；`apple/TV/TVAppModel.swift` | 与 JS 一致的字段及去重边界；原生分页、选集和续播 |
| 公共社区与一起看 | `native/communitySession.js`、`watchTogether.js`；各平台 CommunityBridge/Policy | 媒体服务器鉴权变更不应改写中央服务协议；自建 Jellyfin 不自动获得大河身份 |
| 桌面媒体凭据 | `src/player/PlayerComponent.cpp`：`sanitizeMediaUrl`、`applyMediaAccessToken` | 基线已识别 `api_key` 和 `apikey` 并转 Authorization；保留跨主机重定向保护，无需仅为参数大小写重写整条播放链 |

上述文件以基线加当前未提交实现为定位依据；改动后的函数名和行为以最终 diff 为准。

## 不能遗漏的实现边界

1. **保留既有首页修复。** 基线已包含 Emby 同作品去重。以类型和服务器作品身份合并，没有作品身份时按 Item Id 区分；不要按标题合并，也不要擅自换成 TMDB 去重。Jellyfin 10.11+ 缺字段时应正常显示和翻页，不承诺合并服务器没有给出共同身份的条目。
2. **字段过滤不是删除 UI 信息。** 移除非法 Fields 值后，要在真实响应中确认评分、首播日期、续播时间和 UserData 是否仍可读；不能因请求变成 200 就认为首页正确。
3. **保留路径和凭据边界。** 覆盖根地址、反代子路径、带现有 token 的同源 URL、跨域 CDN、外部字幕及 302。不要覆盖 CDN 自己的签名，不向任意地址添加媒体服务器 Token。
4. **网页功能要实际注册。** Claude 会话已报告检查了 NativeShell 构造参数，但这不等于首页、评论、设置及一起看均已挂载。Jellyfin 12 默认 Modern 布局，需同时验 Modern 与 Legacy，不能只看旧布局能播放。[布局变化](https://jellyfin.org/posts/jellyfin-release-12.0/#the-modern-layout-is-now-the-default)
5. **能力不扩权。** 大河免注册社区身份、私人报错、共享绑定写入与一起看保持既有服务限制。Apple TV 当前不支持一起看、RIFE；Android 当前不支持离线下载。不要在 2.9.0 文案里承诺这些平台原来没有的功能。
6. **版本号不能只识别 10.x。** Jellyfin 新版本以 12.x 命名，服务返回可能包含第三段；不要用只接受 `10.` 的字符串判断。[版本命名](https://jellyfin.org/posts/jellyfin-release-12.0/#why-120)

## 运行验证交接

计划版本为 10.9.11、10.10.7、10.11.0、10.11.11、12.2，均使用独立配置和测试账号；保留 Emby 回归。测试条件、命令和记录矩阵见 [2.9.0 验收方案](../verification/2026-10-19-jellyfin-2.9.0.md)。

Claude 已把 Windows 便携包下载任务放在自己的临时目录。文件存在或长度变化不代表下载完成；后续先核对下载退出结果、ZIP 可读性、包内版本与官方校验信息，再启动。不要复用生产媒体库配置。12.0 官方说明已切换 FFmpeg 8.1，之前下载的 7.1.4-3 不能直接作为 12.2 完整转码验收依据；测试阶段按目标包核对支持版本。[媒体处理说明](https://jellyfin.org/posts/jellyfin-release-12.0/#transcoding-and-media-handling)
