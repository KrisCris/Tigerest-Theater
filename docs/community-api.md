# 评论服务端 API 对接说明（v1）

此文档供另一台机器实现客户端。当前只支持大河的固定 Emby：`62526c3bf747439c99327ddec5fed4a8`。服务端源码位于独立私有仓库，不随客户端公开。客户端尚未实现评论 UI。

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

详情页的评论读取、发送、回复、自身删除都额外携带（消息中心汇总不需要此头）：

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
| GET `/me/comments` | `?limit=20&cursor=...` | `{items,nextCursor,totalCount}`，本人评论及回复汇总 |
| GET `/me/replies` | `?limit=20&cursor=...&unreadOnly=true` | `{items,nextCursor,unreadCount,readThroughToken}`，收到的直接回复 |
| POST `/me/replies` | `{messageIds:[...]}` 或 `{readThroughToken}` | `{markedCount,unreadCount}`，持久化已读 |
| POST `/reports` | `{itemId,category,description,clientRequestId,context?}` | `{report,replayed}`，提交私有报错 |
| GET `/me/reports` | `?limit=20&cursor=...&status=all` | `{items,nextCursor,totalCount}`，本人的报错 |
| GET `/me/reports/{reportId}` | 认证 | 本人单条报错 |
| GET `/me/messages` | `?limit=20&cursor=...&unreadOnly=true&type=all` | `{items,nextCursor,unreadCount,readThroughToken}`，统一消息 |
| POST `/me/messages` | `{messageIds:[...]}` 或 `{readThroughToken}` | `{markedCount,unreadCount}`，统一消息已读 |
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
| GET `/admin/actions` | `?limit=20&cursor=...` | `{items,nextCursor}`，仅评论/作者管理记录；私有报错修复审计仅在局域网后台可见 |

分页 limit 范围 1–50，默认 20；`nextCursor=null` 表示结束。游标按原样传回，不跨话题或列表复用。主评论按新到旧，回复按旧到新。主评论列表内置最多 3 条回复和 `repliesNextCursor`；继续加载用该游标，打开完整回复页则从无游标开始，按评论 ID 去重。

## 消息中心与直接跳转（2026-10-04 新增）

消息中心仍使用 HTTP 18443 的 `/community/v1` 和上述三个 Emby 身份头，不要求 `X-Tigerest-Item-Id`。用户身份由服务端决定，不接受 userId/authorId 作为汇总查询参数。

`GET /me/comments` 返回本人所有主评论和回复，包括删除状态占位，按新到旧分页。每条为 `{comment,location,availability}`，comment 沿用下文对象；totalCount 包括全部历史记录。已删除正文为 null；话题隐藏、媒体移除或当前无权访问时 availability=unavailable、location=null、正文及回复目标资料被清除。不要把该状态当作网络错误或可直接跳转内容。

可用位置示例：

```json
{
  "embyServerId": "62526c3bf747439c99327ddec5fed4a8",
  "itemId": "Emby 条目 ID",
  "scope": "episode",
  "topicId": "话题 UUID",
  "rootId": "主评论 UUID",
  "commentId": "要定位的评论或回复 UUID",
  "title": "本集名称",
  "workTitle": "剧集名称",
  "seasonNumber": 1,
  "episodeNumber": 3,
  "canNavigate": true
}
```

scope=work 跳到电影/整剧详情，episode 跳到单集详情；季集编号可能为 null，不能据此猜测 Item.Id。canNavigate=false 表示目标评论已不在可展示列表，仍可用 itemId 打开媒体，不进行评论定位。

跳转时先打开 itemId 对应详情并切到 scope，原 `GET /topics/{topicId}/comments?anchorId={rootId}` 直接从该主评论开始返回一页；定位回复时再用原 `GET /comments/{rootId}/replies?anchorId={commentId}` 取得目标回复起始页。两个请求仍携带当前详情页的 Item 头；anchorId 与 cursor 互斥。后续加载使用返回的 nextCursor；目标已删除/无权访问返回 404。未传 anchorId 的现有接口行为保持兼容。

`GET /me/replies` 每条为 `{id,createdAt,readAt,isRead,availability,reply,originalComment,location}`：reply 是直接回复自己的内容，originalComment 是被回复的本人主评论或回复。自我回复不产生通知，讨论内其他回复不会额外提醒。原评论删除时正文 null；收到的回复删除、讨论隐藏或媒体权限不足时返回通用不可用占位，reply/originalComment/location 都为 null。

unreadOnly 仅允许 true/false，省略为 false。unreadCount 是未读且回复未删除/讨论未隐藏的通知数；无媒体权限的消息以占位呈现，可标记已读。获取列表或轮询不会自动读消息。旧回复在升级时回填为已读历史，新回复才产生提醒。

用户打开消息后，`POST /me/replies` 提交 `{ "messageIds": ["消息UUID"] }`，每批 1–50 个，仅本人消息；混入未知或他人 ID 整批拒绝。重复标记幂等，markedCount 只计本次新增已读。

“全部已读”提交最新列表返回的 `{ "readThroughToken": "不透明令牌" }`，与 messageIds 二选一。该令牌绑定账号和列表快照，有效 30 分钟；只标记快照内记录，随后收到的新回复仍未读。令牌失效返回 400，刷新列表后重试。已读状态跨客户端、重启保持；无需在客户端维护永久已读清单。

个人列表游标绑定账号、筛选和快照，切换账号或 unreadOnly 时重新从首页请求。取消账号切换前的请求并清空列表/未读缓存；503 应显示暂不可用，不回写空列表或零未读。

## 错误上报与统一消息（2026-10-08 新增）

上述新接口仍在 HTTP 18443，携带原三个 Emby 身份头，不要求单个 `X-Tigerest-Item-Id`。报错只对提交用户与局域网后台管理员可见。

`POST /reports` 示例：

```json
{
  "itemId": "当前电影、剧集或单集的 Emby Item.Id",
  "category": "subtitle_error",
  "description": "第三集播放到十二分钟后，中文字幕比声音提前约三秒。",
  "clientRequestId": "客户端生成的 UUID",
  "context": {
    "positionSeconds": 720,
    "platform": "Windows",
    "clientVersion": "1.0.0",
    "mediaSourceId": "当前播放的媒体源 ID",
    "subtitleStreamIndex": 2
  }
}
```

category 允许 playback_error（播放错误）、subtitle_missing（字幕缺失）、subtitle_error（字幕错误）、other（其他）。description 必填，trim 后 10–2000 个 Unicode 字符、纯文本，可换行；提示用户补充现象、复现方式、字幕语言或发生时间。服务端只接受当前用户可访问的 Movie、Series、Episode，单集同时验证父剧集；媒体名称与位置由服务端确定。

context 可省略，字段也可逐项省略：positionSeconds 为 0–604800 的有限数字；platform/clientVersion 为 1–64 字符；mediaSourceId 为 1–128 字符；subtitleStreamIndex 为 -1–1000 的整数，-1 表示未选择。信息只作为排查线索。不要提交认证头、密码、播放 URL、文件路径或日志；这些不是合法字段。客户端展示说明及修复结果时不得解释 HTML。

同一次提交和网络重试复用 clientRequestId；首次 201、重试 200，返回 `{report,replayed}`。按作者永久去重，同 ID 修改内容或目标返回 409 IDEMPOTENCY_CONFLICT。新提交每用户最多 5 条/分钟，间隔至少 3 秒；重试不占新额度。报错与评论发送分别计数，评论禁言不会阻止报错。

`GET /me/reports` 支持 status=all/open/resolved，默认 all，新到旧分页；详情只接受本人的 reportId。他人或不存在的记录返回 404。report 字段为 `{id,category,description,context,status,createdAt,resolvedAt,resolution,location,availability}`：open 为待处理，resolved 为已修复；待处理时 resolvedAt/resolution=null。resolution 是管理员发给用户的修复说明。

报错位置对应确切的原始 Emby 条目，字段与评论 location 中的媒体部分相同：embyServerId、itemId、scope、title、workTitle、seasonNumber、episodeNumber、canNavigate。没有 topicId/rootId/commentId，按 itemId 打开媒体即可。媒体下架或失去访问权限时 location=null、availability=unavailable；用户仍可查看自己提交的说明和修复结果。

管理员在局域网后台填写修复说明并确认后，服务端原子保存已修复状态、一条只属于提交人的未读通知和审计。相同确认不会重复发送。提交报错本身不产生新消息。

新客户端消息中心使用 `GET /me/messages`，type 允许 all/comment_reply/report_resolved，默认 all；unreadOnly 与分页规则沿用回复列表。返回 `{items,nextCursor,unreadCount,readThroughToken}`，两类消息一起按新到旧排列。unreadCount 是两类当前未读总数，即使筛选单一 type 也返回总数。

消息共有 `{id,type,createdAt,readAt,isRead,availability,location,reply,originalComment,report}`：

- comment_reply：reply/originalComment 沿用旧回复对象，report=null；媒体权限及删除占位规则保持一致，location 可用于评论定位。
- report_resolved：report 为上述报错对象，reply/originalComment=null；显示“报错已修复”及 report.resolution，可打开报错详情或媒体。媒体不可跳转时仍显示修复结果，location=null。

修复通知在媒体下架后仍计未读；回复删除或讨论隐藏仍按旧规则不计未读。GET 和轮询不自动已读。客户端可沿用当前轮询机制读取未读数，无需推送连接。

`POST /me/messages` 同样二选一提交 messageIds（1–50 个，可混合两类）或列表返回的 readThroughToken。未知/他人 ID 整批拒绝、无部分更新；重复标记幂等。快照令牌绑定账号、接口、type 筛选，30 分钟有效；只标记该筛选与快照内消息，之后到达的新消息仍未读。type=all 的令牌用于两类全部已读。

旧 `/me/replies` 保留原响应形状和仅回复的计数，不返回修复消息，拒绝修复消息 ID。新旧接口读取同一回复的同一个消息 ID 和已读状态；任一端标记另一端同步。两组 readThroughToken 不通用，客户端统一消息中心不要把两组未读数相加或重复展示回复。切换接口、type、unreadOnly 或账号时重新从第一页读取；503 不回写空列表/零未读。

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
| 409 `REPORT_ALREADY_RESOLVED` | 报错已有不同的修复结果，刷新详情 |
| 413 `BODY_TOO_LARGE` / 415 `UNSUPPORTED_MEDIA_TYPE` | 请求体最多 16 KiB，使用 JSON |
| 429 `RATE_LIMITED` | 尊重 Retry-After；不要立即循环重试 |
| 503 `AUTH_UNAVAILABLE` / `COMMUNITY_UNAVAILABLE` | 显示暂不可用，可稍后重试；不影响详情或播放 |

并发详情请求应在切换页面/账号时取消，响应只应用到原来的账号和 Item。错误可展示 requestId 供定位，但不要展示认证头。

后续开放其他 Emby 时需要新增可信身份接入方案；目前不能仅改 ServerId 就接入。TMDB 归档已预留电影、剧集、季和集的独立命名空间。
