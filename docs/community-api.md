# 评论服务端 API 对接说明（v1）

此文档供另一台机器实现客户端。当前只支持大河的固定 Emby：`62526c3bf747439c99327ddec5fed4a8`。服务端源码位于独立私有仓库，不随客户端公开。V2.3 客户端已接入详情页评论 UI。

## 连接与认证

评论和弹幕共用 HTTP 18443。局域网地址为 `http://192.168.5.150:18443/community/v1`；同机可使用 `http://127.0.0.1:18443/community/v1`。端口使用 **HTTP**。客户端应从现有弹幕服务地址派生评论地址，不要另设端口。

除健康检查和 CORS 预检外，每个请求都携带当前 Emby 登录会话：

```http
X-Emby-Token: <当前登录的 AccessToken>
X-Emby-Server-Id: <登录响应的 ServerId>
X-Emby-User-Id: <登录响应的 User.Id>
```

服务端校验 Token 的真实所有者。不能把用户名、头像或管理员标记当作身份传入。API Key 和不属于当前用户的 Token 会被拒绝。写操作每次重新验证；读取身份缓存最多 30 秒。退出登录后客户端立即清空评论缓存和待发送内容。

浏览器客户端的 Origin 必须在服务端配置中逐项允许；原生 HTTP 客户端不需要 Origin。所有数据读取和头像下载也需要认证，头像请求不要把 Token 写入 URL。客户端的日志、异常提示和剪贴板示例不能包含 Token。

成功返回 `{ "data": ..., "requestId": "..." }`，失败返回 `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`。头像成功返回图片字节。时间使用 UTC ISO 8601；禁言结束时间 `mutedUntil` 使用 Unix 毫秒。

## 详情页话题

先请求 `GET /me`，取得作者身份、禁言状态和评论管理权限。

```json
{
  "data": {
    "author": { "id": "作者 UUID", "name": "Emby 名称", "avatarPath": null },
    "isCommentAdmin": false,
    "muted": false,
    "muteState": "none",
    "mutedUntil": null
  },
  "requestId": "请求 UUID"
}
```

`POST /topics/resolve`，Content-Type 为 `application/json`：

```json
{ "itemId": "当前 Emby Item.Id", "scope": "work" }
```

`work` 表示电影或整部剧集；在单集详情页用同一 Item.Id 分别解析 `work` 和 `episode`，实现“作品评论”“本集评论”两个入口。季详情只支持作品评论。电影不支持 episode。

话题响应字段为 `id`（UUID）、`scope`、`mediaType`（movie/tv）、`parentWorkId`（单集对应作品 UUID，作品为 null）、`title`、`mappingConflict`。

客户端只提交 Item.Id，TMDB ID、季集编号由服务端向 Emby 读取。没有可靠 TMDB 或季集信息时仍能使用本服话题。映射冲突不会自动移动已有评论；`mappingConflict=true` 时正常展示当前话题即可。

所有评论读取、发送、回复、自身删除都额外携带：

```http
X-Tigerest-Item-Id: <此详情页可访问的 Emby Item.Id>
```

服务端重新验证这个作品是否对当前用户可见，以及它与话题是否对应。知道评论或话题 UUID 不会获得额外访问权限。

## 接口表

以下路径均相对于 `/community/v1`。POST/PUT 使用 JSON。`topicId`、`commentId`、`rootId`、`authorId` 均为服务端返回的 UUID。

| 方法、路径 | 请求 | 返回 data |
|---|---|---|
| GET `/health` | 无认证 | `{status, enabled}`，可用 200，否则 503 |
| GET `/me` | 认证 | 上述身份信息 |
| POST `/topics/resolve` | `{itemId, scope}` | 话题 |
| GET `/topics/{topicId}/comments` | `?limit=20&cursor=...` | `{items, nextCursor, rootCount}` |
| POST `/topics/{topicId}/comments` | `{body, clientRequestId}` | `{comment, replayed}` |
| GET `/comments/{rootId}/replies` | `?limit=20&cursor=...` | `{items, nextCursor}` |
| POST `/comments/{rootId}/replies` | `{body, replyToId, clientRequestId}` | `{comment, replayed}` |
| DELETE `/comments/{commentId}` | 无请求体 | `{rootId}` |
| GET `/avatars/{authorId}?v=...` | 使用返回的 avatarPath | PNG/JPEG/WebP 图片 |
| POST `/admin/comments/{commentId}/delete` | `{scope:"single"或"thread", reason}` | `{rootId}` |
| GET `/admin/mutes` | `?limit=20&cursor=...` | `{items, nextCursor}` |
| PUT `/admin/authors/{authorId}/mute` | `{durationSeconds, reason}` | `{id,name,muted,muteState,mutedUntil}` |
| DELETE `/admin/authors/{authorId}/mute` | 无请求体 | 同上 |
| GET `/admin/actions` | `?limit=20&cursor=...` | `{items,nextCursor}` |

分页 limit 范围 1–50，默认 20；`nextCursor=null` 表示结束。游标按原样传回，不跨话题或列表复用。主评论按新到旧，回复按旧到新。主评论列表内置最多 3 条回复和 `repliesNextCursor`；继续加载用该游标，打开完整回复页则从无游标开始，按评论 ID 去重。

## 评论、回复及删除

评论对象：

```json
{
  "id": "评论 UUID",
  "topicId": "话题 UUID",
  "rootId": null,
  "replyToId": null,
  "author": { "id": "作者 UUID", "name": "名称", "avatarPath": "/community/v1/avatars/作者UUID?v=头像标签" },
  "replyToAuthor": null,
  "replyToState": null,
  "state": "visible",
  "body": "评论正文",
  "createdAt": "2026-10-01T00:00:00.000Z",
  "replyCount": 0,
  "permissions": { "canDelete": true, "canReply": true, "canModerate": false }
}
```

主评论列表对象额外含 `replies` 和 `repliesNextCursor`。回复的 rootId 始终指向主评论，replyToId 可指向主评论或其任意可见回复；replyToAuthor 显示被回复用户的 id、name，replyToState 显示被回复评论状态。所有回复以一层列表展示，客户端在正文前显示“回复 @名称”，不用无限嵌套。

正文是纯文本，trim 后 1–2000 个 Unicode 字符，允许换行；客户端按纯文本渲染，不解释 HTML。发送时生成 UUID 格式 `clientRequestId`，一次提交及其网络重试始终复用同一个 ID。成功首次 201，完全相同重试 200 且 replayed=true；服务端去重窗口为 24 小时。同一个 ID 改正文或目标会返回 409。收到 429 后按 Retry-After 秒数等待；最多每用户 5 条/分钟，相邻新评论或回复至少间隔 3 秒。

作者删除自己评论时正文被清除。主评论还有他人回复时保留占位，state 为 `author_deleted` 或 `moderator_deleted`，body 为 null；客户端显示“评论已删除”。已有回复可继续被回复；被删除的评论本身不可作为新回复目标。管理员 `single` 删除仅清除指定内容；`thread` 只能对主评论使用，会隐藏并清除整条讨论，拒绝后续回复。禁言禁止新评论/回复，仍可读取和删除自己的评论。

权限字段供 UI 展示参考，服务端始终再次判断；禁言状态以 /me 为准。头像字段为 null 或图片返回 404 时使用默认头像，正文不依赖头像加载成功。

## 管理与错误处理

管理入口仅在 `/me.isCommentAdmin=true` 时展示，管理接口不需要 Item 上下文。评论管理员由服务端显式配置，与客户端传参或 Emby 管理员标记无关。禁言时长允许 3600、86400、604800 秒或 0（无限期）；reason 为 1–200 字符。配置中的评论管理员不可被禁言。

审计对象含 `id`（序号）、`actorId`、`action`（delete_single/delete_thread/mute/unmute）、`targetType`、`targetId`、`reason`、`createdAt`；不包含被删除正文。

| HTTP / code | 客户端行为 |
|---|---|
| 400 `INVALID_REQUEST` | 参数或分页格式错误，检查调用 |
| 401 `AUTH_REQUIRED` / `AUTH_INVALID` | 停止发送，刷新登录会话或提示重新登录 |
| 403 `SERVER_NOT_ALLOWED` | 当前 Emby 尚未支持评论服务 |
| 403 `FORBIDDEN` | 无所有权、管理权限或 Origin 未允许 |
| 403 `USER_MUTED` | 提示禁言，重新读取 /me |
| 404 `NOT_FOUND` | 内容不可见、不对应、已隐藏或头像尚未缓存 |
| 405 `METHOD_NOT_ALLOWED` | 检查 HTTP 方法 |
| 409 `IDEMPOTENCY_CONFLICT` | 不重试相同 ID 的不同内容 |
| 409 `TARGET_DELETED` | 刷新讨论并清除旧回复目标 |
| 409 `PROTECTED_ADMIN` | 管理员不可禁言 |
| 413 `BODY_TOO_LARGE` / 415 `UNSUPPORTED_MEDIA_TYPE` | 请求体最多 16 KiB，使用 JSON |
| 429 `RATE_LIMITED` | 尊重 Retry-After；不要立即循环重试 |
| 503 `AUTH_UNAVAILABLE` / `COMMUNITY_UNAVAILABLE` | 显示暂不可用，可稍后重试；不影响详情或播放 |

并发详情请求应在切换页面/账号时取消，响应只应用到原来的账号和 Item。错误可展示 requestId 供定位，但不要展示认证头。

后续开放其他 Emby 时需要新增可信身份接入方案；目前不能仅改 ServerId 就接入。TMDB 归档已预留电影、剧集、季和集的独立命名空间。

