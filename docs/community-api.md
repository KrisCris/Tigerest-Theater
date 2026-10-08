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

成功返回 `{ "data": ..., "requestId": "..." }`，失败返回 `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`。头像成功返回图片字节，诊断日志下载成功返回纯文本。时间使用 UTC ISO 8601；禁言结束时间 `mutedUntil` 使用 Unix 毫秒。

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

context 可省略，字段也可逐项省略：positionSeconds 为 0–604800 的有限数字；platform/clientVersion 为 1–64 字符；mediaSourceId 为 1–128 字符；subtitleStreamIndex 为 -1–1000 的整数，-1 表示未选择。信息只作为排查线索。platform 优先采用客户端原生平台信息，规范值 Windows、macOS、Android、Linux、FreeBSD，无法确定时省略；后台显示此字段。填写“12 分 30 秒”时 positionSeconds 提交数值 750。不要在 context 提交认证头、密码、播放 URL、文件路径或日志；这些不是合法字段。日志使用下面的独立附件接口。客户端展示说明及修复结果时不得解释 HTML。

同一次提交和网络重试复用 clientRequestId；首次 201、重试 200，返回 `{report,replayed}`。按作者永久去重，同 ID 修改内容或目标返回 409 IDEMPOTENCY_CONFLICT。新提交每用户最多 5 条/分钟，间隔至少 3 秒；重试不占新额度。报错与评论发送分别计数，评论禁言不会阻止报错。

`GET /me/reports` 支持 status=all/open/resolved，默认 all，新到旧分页；详情只接受本人的 reportId。他人或不存在的记录返回 404。report 字段为 `{id,category,description,context,status,createdAt,resolvedAt,resolution,location,availability,diagnostics}`：open 为待处理，resolved 为已修复；待处理时 resolvedAt/resolution=null。resolution 是管理员发给用户的修复说明。diagnostics 无附件时为 null，有附件时只含下述元数据；修复消息中的 report 同样返回元数据，列表和通知均不返回日志正文。

报错位置对应确切的原始 Emby 条目，字段与评论 location 中的媒体部分相同：embyServerId、itemId、scope、title、workTitle、seasonNumber、episodeNumber、canNavigate。没有 topicId/rootId/commentId，按 itemId 打开媒体即可。媒体下架或失去访问权限时 location=null、availability=unavailable；用户仍可查看自己提交的说明和修复结果。

管理员在局域网后台填写修复说明并确认后，服务端原子保存已修复状态、一条只属于提交人的未读通知和审计。相同确认不会重复发送。提交报错本身不产生新消息。

新客户端消息中心使用 `GET /me/messages`，type 允许 all/comment_reply/report_resolved，默认 all；unreadOnly 与分页规则沿用回复列表。返回 `{items,nextCursor,unreadCount,readThroughToken}`，两类消息一起按新到旧排列。unreadCount 是两类当前未读总数，即使筛选单一 type 也返回总数。

消息共有 `{id,type,createdAt,readAt,isRead,availability,location,reply,originalComment,report}`：

- comment_reply：reply/originalComment 沿用旧回复对象，report=null；媒体权限及删除占位规则保持一致，location 可用于评论定位。
- report_resolved：report 为上述报错对象，reply/originalComment=null；显示“报错已修复”及 report.resolution，可打开报错详情或媒体。媒体不可跳转时仍显示修复结果，location=null。

修复通知在媒体下架后仍计未读；回复删除或讨论隐藏仍按旧规则不计未读。GET 和轮询不自动已读。客户端可沿用当前轮询机制读取未读数，无需推送连接。

`POST /me/messages` 同样二选一提交 messageIds（1–50 个，可混合两类）或列表返回的 readThroughToken。未知/他人 ID 整批拒绝、无部分更新；重复标记幂等。快照令牌绑定账号、接口、type 筛选，30 分钟有效；只标记该筛选与快照内消息，之后到达的新消息仍未读。type=all 的令牌用于两类全部已读。

旧 `/me/replies` 保留原响应形状和仅回复的计数，不返回修复消息，拒绝修复消息 ID。新旧接口读取同一回复的同一个消息 ID 和已读状态；任一端标记另一端同步。两组 readThroughToken 不通用，客户端统一消息中心不要把两组未读数相加或重复展示回复。切换接口、type、unreadOnly 或账号时重新从第一页读取；503 不回写空列表/零未读。

## 报错诊断日志附件（2026-10-08）

现有 `POST /reports` 请求、认证、16 KiB 请求体上限、限流及幂等规则保持兼容。先提交报错取得 report.id，再单独上传附件；附件失败不能把已提交的报错显示为提交失败，也不能重新创建报错。附件上传不产生额外通知，不改变修复通知及已读状态。

| 方法、路径 | 权限与请求 | 成功返回 |
|---|---|---|
| PUT `/reports/{reportId}/diagnostics` | 本人报错；三个 Emby 身份头，无需 Item 头；无查询参数 | 首次 201，幂等重试 200，`{diagnostics,replayed}` |
| GET `/me/reports/{reportId}/diagnostics` | 本人报错；三个 Emby 身份头，无需 Item 头；无查询参数 | 200，UTF-8 纯文本下载 |

仅接收 `application/json` 或 `application/json; charset=utf-8`，不接受 gzip 等内容编码。上传对象只接受且必须包含以下四个字段：

```json
{
  "clientRequestId": "附件专用 UUID，在重试中复用",
  "capturedAt": "2026-10-08T08:00:00Z",
  "truncated": true,
  "logText": "已经客户端脱敏的诊断信息和相关日志"
}
```

clientRequestId 为 UUID；capturedAt 为合法 UTC ISO 8601，必须以 Z 结尾，允许 1–3 位毫秒；truncated 必须为布尔值；logText 为非空纯文本，允许换行、回车和制表符，不允许其他控制字符、NUL 或无效 Unicode。只接收文本，不接收 ZIP、文件上传或让服务端读取任意文件路径的参数。JSON 原始请求体最多 **8 MiB（8388608 字节）**；解码后 logText 按 **UTF-8 字节**计数，客户端脱敏后和服务端再次脱敏后均不得超过 **1 MiB（1048576 字节）**。

成功 data 示例：

```json
{
  "diagnostics": {
    "id": "服务端附件 UUID",
    "createdAt": "2026-10-08T08:00:01.000Z",
    "capturedAt": "2026-10-08T08:00:00.000Z",
    "expiresAt": "2026-11-07T08:00:01.000Z",
    "bytes": 24000,
    "truncated": true,
    "availability": "available"
  },
  "replayed": false
}
```

bytes 是实际保存的脱敏后文本字节数。每条报错最多一个不可替换附件。相同用户、报错、附件 clientRequestId 及相同 capturedAt/truncated/logText 重试返回 200、replayed=true；UUID 大小写和等价毫秒表示会规范化。相同 ID 修改上述内容返回 409 `IDEMPOTENCY_CONFLICT`，即使修改部分会被脱敏也算冲突；报错已有其他 ID 的附件返回 409 `DIAGNOSTICS_ALREADY_EXISTS`。到期及恢复备份后仍保留幂等记录，相同请求返回已有 expired 元数据，不重新保存正文。

新附件每用户最多 5 次/分钟，间隔至少 3 秒，使用与报错相同的限额值、独立计数，所以报错成功后可以立即上传；成功附件的幂等重试不占新附件额度。IP、读取和失败认证的现有限额仍适用；429 携带 Retry-After 秒数。

| 状态 / code | 含义与客户端处理 |
|---|---|
| 400 `INVALID_REQUEST` | UUID、时间、类型、空正文、控制字符、无效 UTF-8 或非白名单字段错误 |
| 401 `AUTH_REQUIRED` / `AUTH_INVALID` | 缺少或失效身份，停止上传并清除该账号日志快照 |
| 403 `SERVER_NOT_ALLOWED` / `FORBIDDEN` | 不受支持的身份服务或 Origin/后台权限不允许 |
| 404 `NOT_FOUND` | 报错不存在、属于他人，或该报错尚无附件；不泄露是否存在他人报错 |
| 409 `IDEMPOTENCY_CONFLICT` / `DIAGNOSTICS_ALREADY_EXISTS` | 不修改旧附件，不自动换 UUID 重传 |
| 410 `DIAGNOSTICS_EXPIRED` | 正文已到期或备份恢复后无正文；保留报错与修复结果 |
| 413 `DIAGNOSTICS_TOO_LARGE` | JSON 超过 8 MiB，或解码/脱敏后的文本超过 1 MiB |
| 415 `UNSUPPORTED_MEDIA_TYPE` | 不是允许的 UTF-8 JSON 或使用了内容压缩 |
| 429 `RATE_LIMITED` | 按 Retry-After 等待，复用同一快照与 UUID |
| 503 `DIAGNOSTICS_STORAGE_UNAVAILABLE` | 附件存储暂不可用，报错仍已提交；只重试附件 |
| 503 `AUTH_UNAVAILABLE` / `COMMUNITY_UNAVAILABLE` | 身份/服务暂不可用；只重试附件，不重新提交报错 |

保存正文及元数据在私有 SQLite 中原子完成，失败不会发布空附件。本人和局域网后台所有者可读取；其他用户、其他评论管理员、未登录请求不能读取，知道附件 UUID 不能公开下载。媒体下架或访问权限变化后，报错本人和后台所有者仍可访问已有附件。下载返回 `text/plain; charset=utf-8`、`Content-Disposition: attachment; filename="report-diagnostics-<服务端附件UUID>.txt"`、`Cache-Control: no-store` 和 `X-Content-Type-Options: nosniff`。

后台沿用独立局域网端口、指定所有者登录和每次验证的会话权限：`GET /admin/api/reports/{reportId}/diagnostics` 下载；同一路径 `?view=preview` 返回纯文本、Content-Disposition 为 inline，供后台以 textContent 预览。其他查询参数拒绝。详情显示上传时间、实际大小、截断状态、查看/下载和过期状态，不执行正文中的 HTML。

默认从上传成功起保留 **30 天**，私有配置 `community.diagnosticsRetentionDays` 可设置 1–365 的整数。启动、每 60 秒及附件读写时清除到期正文；下载先检查期限，到期立即返回 410，不等待定时器。元数据 availability 改为 expired，报错、修复说明及轻量幂等记录继续保留。此期限针对应用中的正文及已完成常规备份，不承诺原始磁盘/WAL、崩溃临时文件和人工恢复快照的取证擦除。常规备份只保留附件元数据，不保存日志正文；恢复后附件标为 expired，无法从该备份恢复文本，其他报错和已读状态正常保留。

客户端对接流程：报错窗口默认勾选“附带诊断日志”，说明已脱敏且允许取消；仅收集当前账号配置最近约 10 分钟的应用日志，最多 1 MiB，可附上一启动末尾故障记录并标明截断。Windows/macOS 使用当前配置的应用日志；Android 需应用内有界日志记录，不依赖 ADB 或收集其他应用日志。日志无法读取或用户取消时，正常提交报错。

上传前必须覆盖 JSON、HTTP 头、URL 查询参数、大小写与 URL 编码，移除登录 Token、认证头、密码、签名/敏感查询参数、本地绝对路径及私人账号信息；保留状态码、组件错误、播放器状态、字幕/弹幕匹配等线索。服务端对已知格式再次脱敏，包括令牌/密码/账号字段、认证及 Cookie 头、URL 凭据和完整查询参数、已知路径；这不能替代客户端脱敏。服务日志不写入附件正文或请求头。

**只抓取一次日志快照、生成一次附件 UUID**；网络重试不能重新抓取变化后的日志。成功显示“报错已提交，诊断日志已附带”；附件失败显示“报错已提交，日志上传失败”，提供单独重试。退出登录、切换账号或取消操作时中止待发请求并清除内存快照。此版本交付后端契约，客户端自动采集/上传与 UI 由客户端后续实现。

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
