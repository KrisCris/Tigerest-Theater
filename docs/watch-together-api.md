# 一起看服务端 API（v1，实际实现）

状态：**2026-10-15 21:37（Asia/Shanghai）已部署到 NAS，并完成线上接口验证；21:39 独立复核通过。** 本文描述当前已上线的实际接口。协议版本为 `protocol: 1`，路径为 `/watch/v1`。客户端先检查 `/health`，只有 HTTP 200 且 `data.enabled === true` 才启用入口。正式客户端多设备播放效果和另一公网的独立网络联调仍待完成，不能把后端接口验证当作播放器验收。

本文是前后端对接主文档，包含认证、完整字段、REST 示例、WebSocket 消息、并发规则、限额及错误处理。原第三版提案另存 `watch-together-api-v3-proposal.md`，以本文的实际实现说明为准。本文不包含登录凭据，也不要求修改客户端的视频拉流与 Emby 进度回报通道。

**修订记录**

- 2026-10-15 21:37 上线版：92 文件版本已安装，SYSTEM 开机任务运行正常，原配置逐字节保持。线上真实 Emby 会话验证普通4人/管理员20人、创建幂等、原子换房、WS心跳与播放控制、等待/恢复、切集、旧版本拒绝、连接替换及踢人禁入；测试房间已释放。局域网和公网域名的健康检查及 WebSocket Upgrade 从 NAS 发起验证通过。

- 2026-10-15 实现版：保留第三版协议，补齐实际参数校验、错误响应、关闭码、请求取消与关停规则。明确：成功 hello 后作废该成员其他未用票据；较早的创建/加入不能覆盖较新的入房/离开；票据满额等失败不能先离开旧房间；异步会话核验不阻塞播放及连接计时。具体行为和示例以下文为准。

- 2026-10-15 第 1 版：初稿。
- 2026-10-15 第 2 版：按后端评审补齐五处边界，接口路径和消息格式的其余部分不变。
  1. 创建、加入、申请票据的 REST 请求都带 `clientId`，票据签发时绑定，hello 时核对（见「WebSocket 票据」）。
  2. 断线与座位：
     - 有人在线时才计座位时间；全员断线时休眠，所有人都能在 `emptyRoomSeconds` 内重连；
     - 房主只转给在线成员（见「断线与座位」）。
  3. 加入：
     - 已是成员先于满员判断；
     - 目标的检查先于 `ALREADY_IN_ROOM`；
     - `leaveCurrent` 在目标全部检查通过后才离开旧房间（见「REST 接口」）。
  4. 切集：
     - 核对期间不加锁；
     - 同时只处理一个切集（`CHANGE_IN_PROGRESS`）；
     - 提交前再查版本和成员集合（见 `changeItem`）。
  5. 等待名单：
     - 缩短时发 `waiting` 消息、不加 revision；
     - 列明哪些变化加 revision；
     - 旧版本的 status 不参与等待和缓冲计时（见「等待规则」「状态上报」）。
- 2026-10-15 第 3 版：按第二轮评审补齐三处并发和失败处理。
  1. 切集提交前还要确认房间存在、发起者仍是成员；发起者中途离开或被移出时放弃（`INITIATOR_LEFT`），见 `changeItem` 第 4 步。
  2. 加入在占用座位前复核：房间仍在、未满员、条目没变；条目变了就对新条目重新验权，失败时不占座位、不离开旧房间。新增 `ROOM_CHANGED`，见「POST /rooms/join」。
  3. 新增全房间的 `itemChange` 通知：开始核对时发 `pending`，每次切换最终恰好发一条 `committed` 或 `cancelled`；快照增加 `pendingChange`；客户端 10 秒未收到结束通知时重读快照。见「切换进度通知」。

## 目标与范围

- 大河专属 Emby（ServerId `62526c3bf747439c99327ddec5fed4a8`）的登录用户可以创建房间，用房间码邀请其他大河用户，以相同的进度观看同一部电影或同一集。
- **房间内所有成员都能控制**：播放、暂停、拖动进度、切换剧集，不区分房主和成员的控制权。房主只多出踢人和解散房间。
- **人数上限（默认值，含创建者）：** 普通用户创建的房间最多 4 人；创建者是大河 Emby 管理员（由当前会话读到的 Policy 判定）时最多 20 人。
- 第一版不做：房间聊天、语音、消息中心邀请、公开房间列表、自建 Emby 用户加入。协议为聊天和语音预留了扩展位置（见「扩展预留」），第一版实现时不要占用这些消息类型。

服务端是房间状态的唯一来源：保存房间的媒体、播放状态和时间锚点，按到达顺序处理成员的操作并广播。服务端不转发、不代理视频流；每个成员仍各自从 Emby 拉流，各自向 Emby 回报观看进度。

## 部署与地址

以下地址已在本次部署后验证：局域网与公网域名的 `/health` 均返回 HTTP 200、`enabled:true`、`protocol:1`，WebSocket Upgrade 均能建立连接并拒绝无效票据。公网域名检查由 NAS 发起；另一外部网络尚未独立实测。部署沿用原端口、配置和 SYSTEM 开机任务，没有修改防火墙规则。

- 与评论、弹幕在同一进程和端口。局域网 `http://192.168.5.150:18443/watch/v1`，外网 `http://nas.tigerest.top:18443/watch/v1`。客户端按评论服务的同一规则选择主机：Emby 地址主机为 `192.168.5.150` 时用局域网地址，否则用 `nas.tigerest.top`。
- 实时通道：`ws://<同一主机>:18443/watch/v1/socket`。如果 18443 前面有反向代理或端口转发设备，需要放行 WebSocket Upgrade，空闲超时不低于 60 秒。
- 房间状态只保存在内存，不写数据库。服务重启后所有房间结束；客户端重连时申请票据得到 404 `ROOM_ENDED`，提示「房间已结束」。

私有配置名称和默认值已经固定。`watch.enabled` 默认 true，但还必须有成功初始化的现有 `community` 可信 Emby 身份服务；关闭社区身份服务、身份库不可用或 watch 配置不合法时一起看不会开放。配置改变后需重启，已有房间随之结束。

| 配置 | 默认 | 含义 |
|---|---|---|
| `watch.enabled` | true | 关闭时 `/health` 报 enabled=false，其他接口 503 `WATCH_UNAVAILABLE` |
| `watch.roomCapacity` | 4 | 普通用户创建的房间人数上限 |
| `watch.adminRoomCapacity` | 20 | 管理员创建的房间人数上限 |
| `watch.maxRooms` | 50 | 同时存在的房间数上限 |
| `watch.seatHoldSeconds` | 60 | 断线成员保留座位的时间 |
| `watch.emptyRoomSeconds` | 300 | 所有成员都断线后房间保留的时间 |
| `watch.waitTimeoutSeconds` | 15 | 等待成员就绪的最长时间 |
| `watch.maxRoomHours` | 24 | 房间最长存在时间 |

数值配置都要求整数：两种人数 1–20、房间数 1–50、座位秒数 1–600、休眠秒数 1–3600、等待秒数 1–60、最长小时数 1–24。不要在 `watch` 中加入未定义的配置键。

## 认证与身份

REST 接口沿用 `/community/v1` 的三个 Emby 身份头和同一个验证器：

```http
X-Emby-Token: <当前登录的 AccessToken>
X-Emby-Server-Id: <登录响应的 ServerId>
X-Emby-User-Id: <登录响应的 User.Id>
```

- 只接受可信的大河 Emby；其他 ServerId 返回 403 `SERVER_NOT_ALLOWED`。API Key、不属于当前用户的 Token 一律拒绝。
- 浏览器 Origin 白名单与评论服务相同（页面来自大河 Emby 的网页端）；原生 HTTP 客户端不带 Origin 时允许。CORS 预检需允许上述三个头。
- 成员身份对外只显示评论作者身份：`authorId`、`name`、`avatarPath`，与 `/community/v1/me` 返回的相同，客户端用现有方式加载头像。不得向其他成员暴露 Emby UserId、设备 ID、IP 或 Token。
- **管理员判定：** 创建房间时，服务端用创建者自己的会话向 Emby 读取 `GET /Users/{userId}` 的 `Policy.IsAdministrator`，为 true 时容量为 `adminRoomCapacity`。
  - 不要用评论服务的 `isCommentAdmin`：评论管理员由服务端单独配置，与 Emby 管理员无关。
  - 客户端不能自行声明。
  - 容量在创建时确定，之后房主转移也不变。

### WebSocket 票据

浏览器的 WebSocket 不能带自定义请求头，Token 也不能写进 URL，所以实时通道使用一次性票据：

1. 客户端带身份头调用 REST 创建房间、加入房间或申请票据，请求体中带上 `clientId`，得到 `ticket`。
2. 客户端连接 `/watch/v1/socket`。握手时检查 Origin 白名单，不通过返回 403。
3. 连接后第一条消息为 `hello`，携带票据和同一个 `clientId`。

`clientId` 是客户端为每个应用配置生成并持久保存的 UUID，用来区分同一用户的不同设备和配置。服务端只用它绑定票据，不向其他成员展示。

票据为至少 128 位的随机值，单次使用，30 秒内有效，签发时绑定用户、房间和请求中的 `clientId`。以下情况一律关闭连接，关闭码 4401，并作废该票据：
- 连接后 5 秒内未收到 `hello`；
- 票据无效、过期或已用过；
- hello 中的 `clientId` 与签发时不同。

票据不写入任何日志。

**连接替换边界：** 成功 hello 后，服务端同时作废该成员此前签发的其他未使用票据，防止旧设备用迟到票据抢回连接。之后新申请的票据仍可替换连接。不要同时启动多个自动重连任务；4409 后停止自动重连。错误 clientId 会消耗所提交的票据；失败后必须重新申请。

### 会话复核

成员存在期间（含保留座位），服务端在进程内存中保留 REST 验证及成功 hello 使用的 Emby Token：不落盘、不写日志，成员离开房间或座位过期时立即丢弃。用途只有两个：

- 每 10 分钟强制重新核验一次会话；周期复核不复用 30 秒读缓存。失效时发送 `closed {reason:"auth_expired"}` 并以 4401 关闭，成员移出房间。Emby 暂时不可用不等同于会话失效，约 30 秒后再试；单次核验有 5 秒期限，期间其他房间与连接计时照常执行。
- 切换媒体时，用每个成员自己的会话核对能否访问新条目（见 `changeItem`）。

## 房间快照

```json
{
  "roomId": "房间 UUID",
  "code": "7KQ2MZ",
  "capacity": 4,
  "createdAt": "2026-10-15T12:00:00.000Z",
  "ownerMemberId": "成员 UUID",
  "pendingChange": null,
  "media": {
    "itemId": "Emby Item.Id",
    "mediaSourceId": "媒体源 ID",
    "type": "Episode",
    "title": "本集名称",
    "seriesName": "剧集名称",
    "seasonNumber": 1,
    "episodeNumber": 3,
    "runTimeMs": 1440000
  },
  "playback": {
    "revision": 12,
    "state": "playing",
    "positionMs": 734500,
    "serverTime": 1834567.25,
    "rate": 1,
    "waiting": null,
    "lastAction": { "type": "seek", "memberId": "成员 UUID", "serverTime": 1834267.25 }
  },
  "members": []
}
```

- `media` 的标题、季集号和时长由服务端用创建者（或切换者）的会话从 Emby 读取，不信任客户端提交的展示信息。电影的 `seriesName`、`seasonNumber`、`episodeNumber` 为 null。
- **serverTime：** 服务端单调时间轴上的毫秒数，可带最多 3 位小数。它不是 UTC，不随系统校时跳变；客户端只用它算差值。全进程共用一条时间轴，服务重启后可以重新从任意值开始。
- **revision：** 每次播放状态或媒体变化加 1 的整数。客户端只应用更新的版本，并在控制命令中带上自己看到的版本。
- **playback.state 的含义：**
  - `paused`：所有人停在 `positionMs`。
  - `playing`：在服务端时间 t，应处位置 = `positionMs + (t − serverTime) × rate`。`serverTime` 可以在将来，表示「在这一刻从 positionMs 开始播放」；在此之前客户端停在 positionMs 等待。
  - `waiting`：所有人停在 `positionMs`，等待成员就绪。`waiting = {memberIds:[...], deadline: serverTime, resumeTo: "playing"}`，`memberIds` 是还没有就绪的成员。
- `rate` 第一版固定为 1，预留给以后的全房间倍速。
- `lastAction.type` 取值：`create`、`play`、`pause`、`seek`、`changeItem`、`buffer`（因成员缓冲进入等待）、`resume`（等待结束开始播放）、`timeout`（等待超时后开始播放）。`memberId` 是触发者；由服务端自动产生的 `resume`、`timeout` 为 null。

成员对象：

```json
{
  "memberId": "成员 UUID",
  "authorId": "评论作者 UUID",
  "name": "名称",
  "avatarPath": "/community/v1/avatars/作者UUID?v=头像标签",
  "role": "owner",
  "platform": "Windows",
  "connection": "online",
  "status": "playing",
  "lagging": false,
  "joinedAt": "2026-10-15T12:00:00.000Z"
}
```

- `memberId` 在这个房间的成员身份内保持不变，包括同一用户在保留座位期间的重连。
- `role` 为 `owner` 或 `member`。`connection` 为 `online` 或 `reconnecting`（已断线、仍保留座位）。
- `status` 来自客户端上报：`loading`、`buffering`、`ready`、`playing`、`paused`、`away`、`ended`、`error`。`away` 表示成员在房间里但没有打开播放器（例如在浏览详情页，或 Android 进入后台）。
- `lagging=true` 表示该成员没能跟上，房间不再等他，由他的客户端自行追赶（见「等待规则」）。

## REST 接口

以下路径均相对于 `/watch/v1`。POST 使用 JSON，请求体最多 16 KiB。返回格式与评论服务相同：成功 `{ "data": ..., "requestId": "..." }`，失败 `{ "error": { "code": "...", "message": "..." }, "requestId": "..." }`。

认证头适用于除 `/health` 和 CORS `OPTIONS` 外的所有 REST 接口。响应使用 `application/json; charset=utf-8` 和 `Cache-Control: no-store`。POST 有正文时要求 `Content-Type: application/json`，仅接受未压缩正文；空正文只适用于 `/leave`。字段类型严格校验，额外字段、数组正文、query 参数或编码变形路径均不接受。HTTP 方法不匹配返回 405。

服务端为每次 REST 请求生成 `requestId`；它与创建请求里的 `clientRequestId` 不同。超过同时在途 HTTP 数量的入口拒绝只返回 `error`，可能没有 `requestId`。错误 `message` 当前与 `code` 相同，客户端自行提供中文提示，不解析 message 文本。

| 方法、路径 | 请求 | 返回 data |
|---|---|---|
| GET `/health` | 无认证 | `{status, enabled, protocol: 1}`，可用 200，否则 503 |
| GET `/me` | 认证 | `{author, capacity, activeRoom, features}` |
| POST `/rooms` | `{itemId, mediaSourceId, positionMs, clientRequestId, clientId, leaveCurrent?}` | 首次 201，重试 200：`{room, ticket, ticketExpiresAt, replayed}` |
| POST `/rooms/join` | `{code, clientId, leaveCurrent?}` | `{room, ticket, ticketExpiresAt}` |
| POST `/rooms/{roomId}/tickets` | `{clientId}` | `{ticket, ticketExpiresAt}` |
| POST `/rooms/{roomId}/leave` | 无请求体 | `{left: true}`，幂等 |
| GET `/rooms/{roomId}` | 认证 | `{room}` |

- **GET /me：** `author` 为 `{id, name, avatarPath}`，其中 `author.id` 映射到成员的 `authorId`，不能当成 Emby UserId。`capacity` 是该用户现在创建房间时的人数上限（默认 4 或 20）。`activeRoom` 为 `{roomId, code, title}` 或 null，客户端据此在启动后恢复房间。`features` 第一版为 `["sync"]`。
- **POST /rooms：**
  - 条目类型只接受 `Movie` 和 `Episode`，其他返回 422 `ITEM_TYPE_UNSUPPORTED`。
  - 用创建者自己的会话确认能访问该条目，`mediaSourceId` 属于该条目，`positionMs` 在 0 到时长之间。
  - 初始状态为 `paused`、`revision=1`、`lastAction.type="create"`，创建者为房主。
  - `clientRequestId` 为 UUID，10 分钟内幂等：相同 ID 和内容重试时，若房间仍在，返回同一房间和一张新票据；相同 ID 改了内容返回 409 `IDEMPOTENCY_CONFLICT`。
- **POST /rooms/join：** 房间码不区分大小写，去掉首尾空白。按以下顺序检查，第一个不满足的条件决定返回：
  1. 房间存在且未结束，否则 404 `ROOM_NOT_FOUND`。
  2. **已是这个房间的成员**（包括保留座位中的断线成员）：直接返回房间快照和新票据，不再做后面的检查，也不计入满员判断。这是重连的另一条路径，效果与申请票据相同。
  3. 没有被这个房间踢出，否则 403 `KICKED`。
  4. 没有满员（保留座位中的断线成员也计入），否则 409 `ROOM_FULL`。
  5. 用加入者自己的会话能访问房间当前的条目，否则 403 `ITEM_FORBIDDEN`。
  6. 不在其他房间；在其他房间且未带 `leaveCurrent`，返回 409 `ALREADY_IN_ROOM`（见下条）。

  **提交前复核：** 第 5 步要向 Emby 查询，期间房间可能已经切换条目或坐满。所以占用座位前，要在同一个原子步骤里再确认一次：
  - 房间仍存在且未结束，否则 404 `ROOM_ENDED`。
  - 仍未满员，否则 409 `ROOM_FULL`。
  - 房间当前的 `media.itemId` 仍是第 5 步核对过的条目。
    - 若已切换，用加入者的会话对新条目重新核对，然后再回到本复核。
    - 重新核对失败返回 403 `ITEM_FORBIDDEN`。
    - 最多重新核对 2 次，条目仍在变化则返回 409 `ROOM_CHANGED`，客户端可稍后重试。

  任何一项失败都不占用座位；带 `leaveCurrent` 时也不离开旧房间。

  还会核对该用户的成员身份在异步验权期间是否已被其他请求改变。如果较早的加入尚未完成，用户已经通过另一请求加入、离开或切房，较早请求返回 `ROOM_CHANGED`，不会重新占座或覆盖较新的选择。创建也受此约束；未允许换房且已在房间时仍可能返回 `ALREADY_IN_ROOM`。HTTP 取消或超时的验权结果不会在后台继续提交成员迁移。

  全部通过后占用座位。成员在 `members` 广播中出现，`connection` 为 `reconnecting`，直到 WebSocket 的 hello 完成。票据过期而未连接时，按「断线与座位」规则处理。

  反方向的竞态由 `changeItem` 负责：加入先完成、切换后提交时，切换在提交前发现成员集合多了未核对的新成员，会放弃切换（见 `changeItem` 第 4 步）。
- **一人只能在一个房间：**
  - 已在其他房间时，创建和加入返回 409 `ALREADY_IN_ROOM`，`error` 中附带 `activeRoom`。客户端询问用户后，带 `leaveCurrent: true` 重试。
  - 这个检查放在目标的所有其他检查之后：目标房间进不去（满员、无权访问等）或新房间建不成（条目无效等）时，返回的是那个错误，不是 `ALREADY_IN_ROOM`。用户不会在确认离开旧房间后才发现进不了新房间。
  - 带 `leaveCurrent: true` 时，**先完成目标的全部检查，再在同一个原子步骤里离开旧房间并加入或创建新房间**。任何检查失败都不离开旧房间。离开旧房间的效果与主动离开相同（房主转移、最后一人离开时房间结束），旧连接收到 `closed {reason:"left"}`。
- **POST /rooms/{roomId}/tickets：** 只有本房间的成员（包括保留座位中的断线成员）可以申请，用于重连，不做满员检查。房间已结束返回 404 `ROOM_ENDED`；不是成员（包括座位已过期被移出）返回 404 `NOT_FOUND`，不透露房间是否存在。
- **POST /rooms/{roomId}/leave：** 移出成员并释放座位；该用户若仍有连接，收到 `closed {reason:"left"}` 并以 1000 关闭。房主转移规则见「断线与座位」。最后一个成员（不论其他人是否在线）主动离开后，房间里没有成员了，立即结束。
- **GET /rooms/{roomId}：** 只有成员可读，否则 404 `NOT_FOUND`。

### REST 字段与可直接照抄的请求形状

| 字段 | 类型和校验 |
|---|---|
| `itemId` / `mediaSourceId` | 非空字符串，最长 128 字符，不含控制字符；ID 不由后端推断 |
| `clientId` | 必填 UUID，每个应用配置持久化；必须与 hello 相同 |
| `clientRequestId` | 创建必填 UUID，单次创建意图的幂等键；失败重试沿用，用户主动新建使用新值 |
| `positionMs` | 毫秒数，可以是小数，必须有限；创建省略为 0，范围 0..时长，越界 400；WS 控制则截断到有效范围 |
| `leaveCurrent` | 可选布尔值，默认 false，不接受字符串 `"true"` |
| `code` | 非空字符串，最长 32 字符，去首尾空格、忽略大小写后匹配 6 位房间码 |
| `roomId` | 路径 UUID，来自快照，不是房间码 |

创建：`POST /watch/v1/rooms`

```json
{
  "itemId": "12345",
  "mediaSourceId": "source-id-from-emby",
  "positionMs": 0,
  "clientRequestId": "8188c854-4c72-42e9-859b-6f9675ae7c6d",
  "clientId": "13f7e2be-ebcc-4016-b47f-063d45e3200d",
  "leaveCurrent": false
}
```

首次响应 HTTP 201；下面的 `room` 代表本节之前给出的完整快照，示例票据不可用：

```json
{
  "data": {
    "room": {"roomId":"7e47169f-0801-48bf-9d0a-b113488376ad","code":"7KQ2MZ"},
    "ticket": "opaque-single-use-ticket",
    "ticketExpiresAt": "2026-10-15T13:00:30.000Z",
    "replayed": false
  },
  "requestId": "44f7b6d0-76ee-4edc-8570-7bf52a7a5e8d"
}
```

同一 `clientRequestId` 的重复请求会计入创建限流；10 分钟内比较 `itemId`、`mediaSourceId`、位置（默认 0）、`clientId` 和 `leaveCurrent`（默认 false），改变其中任一值返回 `IDEMPOTENCY_CONFLICT`。重试不会替你重新加入已经离开的房间：房间结束返回 `ROOM_ENDED`，已不是成员返回 `NOT_FOUND`。

加入：`POST /watch/v1/rooms/join`，成功 HTTP 200，`data` 含 `room`、`ticket`、`ticketExpiresAt`：

```json
{"code":"7KQ2MZ","clientId":"13f7e2be-ebcc-4016-b47f-063d45e3200d","leaveCurrent":false}
```

取新票据：`POST /watch/v1/rooms/7e47169f-0801-48bf-9d0a-b113488376ad/tickets`：

```json
{"clientId":"13f7e2be-ebcc-4016-b47f-063d45e3200d"}
```

主动离开同路径下的 `/leave`：POST 无正文或 `{}`，成功 HTTP 200，`data={"left":true}`。不在该房间也成功；不会因传入别人的房间 UUID 移出其成员。恢复页面时先 GET `/me`，再 GET `/rooms/{roomId}` 取得完整状态。

典型错误响应（HTTP 409）：

```json
{
  "error": {
    "code": "ALREADY_IN_ROOM",
    "message": "ALREADY_IN_ROOM",
    "activeRoom": {"roomId":"7e47169f-0801-48bf-9d0a-b113488376ad","code":"7KQ2MZ","title":"当前影片"}
  },
  "requestId": "44f7b6d0-76ee-4edc-8570-7bf52a7a5e8d"
}
```

## 实时通道

消息为 JSON 文本帧，每帧最多 16 KiB，统一形如 `{"type": "...", ...}`。客户端发出、需要回复的消息带 `requestId`（客户端生成的 UUID），服务端在 `ack` 或 `error` 中原样返回。

### 建立连接

客户端发送：

```json
{
  "type": "hello",
  "protocol": 1,
  "ticket": "一次性票据",
  "clientId": "客户端配置级 UUID",
  "platform": "Windows",
  "appVersion": "2.8.0",
  "capabilities": ["sync"]
}
```

`platform` 取 Windows、macOS、Android、iPadOS 之一，1–32 字符；`appVersion` 1–32 字符。服务端回复：

```json
{
  "type": "welcome",
  "memberId": "成员 UUID",
  "serverTime": 1834567.25,
  "room": { "...": "完整房间快照" },
  "features": ["sync"],
  "heartbeatSeconds": 5
}
```

同一用户再次连接（换设备或重连）时，新连接取代旧连接：旧连接收到 `closed {reason:"replaced"}` 并以 4409 关闭，成员身份和 `memberId` 不变。

服务器不要求 Upgrade 请求携带 Emby 头；认证只使用 hello 票据。URL 必须精确为 `/watch/v1/socket`，不能追加 token、ticket 或其他 query 参数。启用失败握手返回 HTTP 503，Origin 不允许返回 HTTP 403，此时连接尚未建立，不能期待收到 WebSocket `closed` 消息。

`hello` 不带 `requestId`；`capabilities` 为必填字符串数组，最多 16 项，每项最多 32 字符，实际支持的功能仍只有 `sync`。客户端应带 `["sync"]`。`platform` 必须为上列四个枚举值；`appVersion` 为非空字符串。重复 hello 不是刷新票据的方式。第一条不是合法 hello、二进制消息或非法 JSON 会关闭连接。hello 之前没有成员消息可见；成功后先收到 `welcome`，随后才收到广播。

### 校时与心跳

客户端发送 `{"type":"ping","id":17,"t0":123456.7}`，`t0` 是客户端自己的时钟，服务端原样返回。服务端立即回复：

```json
{"type":"pong","id":17,"t0":123456.7,"serverReceive":1834567.25,"serverSend":1834567.31}
```

两个时间取自同一条单调时间轴。pong 应尽量不排在大批广播之后发出，回复越快，客户端校时越准。客户端连接后先连续发送数次，之后每 5 秒一次；ping 同时充当心跳。服务端 20 秒内没有收到该连接的任何消息时，以 4408 关闭。

`ping.id` 要求非负安全整数，`t0` 要求非负有限数。不使用 WebSocket 控制帧 ping 替代以上应用层 JSON 心跳；后台或播放暂停时也要保持 JSON 心跳。

### 控制命令（任何成员）

`pause`、`play`、`seek`、`changeItem` 都带 `requestId` 和 `baseRevision`（客户端当前看到的版本）。

- `baseRevision` 不等于当前版本时拒绝，状态不变，回复 `error {code:"STALE_REVISION", room}`。这表示别人刚刚抢先操作了，客户端按最新状态处理并提示用户。这样同时操作的两个人不会互相覆盖。
- 接受时版本加 1，向全房间（包括操作者）广播 `state`，并给操作者回复 `{"type":"ack","requestId":"...","revision":13}`。
- 所有 `positionMs` 截断到 0 到 `media.runTimeMs` 之间。

控制消息示例（UUID 每次用户操作新建，版本必须替换为客户端已应用的实际版本）：

```json
{"type":"pause","requestId":"c0c6dc4a-73ac-4ff9-936d-7f7a2ad3e470","baseRevision":12,"positionMs":734500}
{"type":"play","requestId":"b9c9064d-dd5b-413f-b7aa-66da9c018fac","baseRevision":13}
{"type":"seek","requestId":"ca51cbbb-e327-4b9e-8dd3-5e9db8f9cb37","baseRevision":14,"positionMs":800000}
{"type":"changeItem","requestId":"f4be0f09-5992-4a65-a05f-d1b35d7d603b","baseRevision":15,"itemId":"12346","mediaSourceId":"next-source","positionMs":0}
```

`baseRevision` 必须为正安全整数；pause/seek 的位置必填，play 不接受位置字段。未知字段会被拒绝。WS 的 `requestId` 仅用于关联响应，**没有请求去重缓存**。如果发命令后断线或没收到 ack，重新取得快照再判断，不盲目重发；已提交命令的旧 baseRevision 会被拒绝。单纯更新 requestId 不改变版本规则。

各命令：

- `pause {positionMs}`：状态改为 `paused`，位置为操作者给出的 `positionMs`，立即生效。操作者的客户端已在本地先暂停，其他人收到后暂停并对齐到这个位置。房间在 `waiting` 时同样可以暂停，等待随之取消。
- `play {}`：从 `paused` 或 `waiting` 开始播放，`state=playing`，`positionMs` 为当前停住的位置，`serverTime = 当前服务端时间 + leadMs`（见下）。房间已在播放时直接回复 ack，不加版本。
- `seek {positionMs}`：
  - 房间暂停时：仍为 `paused`，位置改为新位置。
  - 房间在播放或等待时：进入 `waiting`，位置为新位置，`resumeTo="playing"`，`memberIds` 为参与等待的成员（见「等待规则」），`deadline = 当前时间 + waitTimeoutSeconds`。
- `changeItem {itemId, mediaSourceId, positionMs}`（`positionMs` 省略为 0）：
  - 条目类型和媒体源的检查同创建房间，用操作者的会话读取媒体信息。
  - 用每个成员（在线和保留座位中的）自己的会话并行核对能否访问新条目，单次超时 5 秒。
    - 有人无权访问时拒绝，回复 `error {code:"MEMBER_ITEM_FORBIDDEN", memberIds:[...]}`，状态不变。
    - 核对时 Emby 不可用或超时，回复 `WATCH_UNAVAILABLE`，状态不变。
  - **核对期间房间不加锁**，其他成员仍可暂停、播放、拖动，成员仍可加入或离开。处理规则：
    1. 收到命令时先检查 `baseRevision`，不等于当前版本立即回复 `STALE_REVISION`，不开始核对。
    2. 每个房间同时只处理一个 `changeItem`。核对进行中再收到 `changeItem`，回复 409 `CHANGE_IN_PROGRESS`，不排队。
    3. 记下开始核对时的成员集合，并行核对。
    4. 核对完成后，提交前再次检查。以下任一不满足就放弃本次切换，状态不变：
       - 房间仍存在；房间已结束时直接放弃，不再回复。
       - 发起者仍是本房间成员（在线或保留座位中均可）。发起者核对期间主动离开、被踢、会话失效或座位过期时放弃，原因为 `INITIATOR_LEFT`；发起者已不在房间，不再回复他。
       - 当前版本仍等于 `baseRevision`，否则回复发起者 `STALE_REVISION`（附最新 room）。
       - 核对期间当前成员中有人完成新的 hello、替换连接或凭据时，旧核对结果失效，返回 `STALE_REVISION`；客户端取得最新快照后再决定是否重试。
       - 当前成员集合中，没有不在步骤 3 集合里的新成员，否则同样回复 `STALE_REVISION`。核对期间**发起者以外**的成员离开不影响提交。

       客户端可以按最新状态决定是否重新发起。
    5. 检查通过后，在同一步骤中替换 `media`，进入 `waiting`，`resumeTo="playing"`，版本加 1 并广播 `state`。
  - **切换进度通知：** 开始核对和处理结束时，都向全房间（包括发起者）发送 `itemChange` 消息，见「切换进度通知」。所以收到 `CHANGE_IN_PROGRESS` 的客户端总能知道切换何时结束，不会一直等下去。
  - 核对期间加入的新成员，靠步骤 4 的成员集合检查和「POST /rooms/join」的提交前复核共同保证：不论两者谁先完成，新成员都不会被带进他无权访问的条目。
  - 剧集播完自动下一集也走这个命令。几个客户端同时发出时，都带同一个 `baseRevision`：第一个开始核对；其余收到 `CHANGE_IN_PROGRESS`，或在它提交后收到 `STALE_REVISION`，之后跟随第一个的结果。第一个失败时，其余客户端从 `itemChange {phase:"cancelled"}` 得知，可按最新状态重新发起。

**切换进度通知**（服务端 → 客户端，全房间）：

```json
{"type":"itemChange","phase":"pending","changeId":"切换 UUID","memberId":"发起者成员 UUID"}
{"type":"itemChange","phase":"committed","changeId":"切换 UUID","memberId":"发起者成员 UUID","revision":14}
{"type":"itemChange","phase":"cancelled","changeId":"切换 UUID","memberId":"发起者成员 UUID","reason":"MEMBER_ITEM_FORBIDDEN"}
```

- `pending` 在开始核对时发送，客户端可显示「XX 正在切换」。
- 每次切换最终恰好发一条 `committed` 或 `cancelled`：
  - `committed` 紧跟在对应的 `state` 之后发送；
  - `cancelled` 的 `reason` 取 `MEMBER_ITEM_FORBIDDEN`、`WATCH_UNAVAILABLE`、`STALE_REVISION`、`INITIATOR_LEFT` 之一。
  - 房间结束导致的放弃不发送，因为客户端会收到 `closed`。
- 操作者提供不支持的条目类型或错误媒体源时，其 `error.code` 保留 `ITEM_TYPE_UNSUPPORTED` / `MEDIA_SOURCE_INVALID`；为兼容第三版的全房间 reason 枚举，对应 `cancelled.reason` 使用 `WATCH_UNAVAILABLE`。其余成员只据结束通知取消忙碌状态，详细失败提示使用操作者收到的 error。
- 通知中**不包含**目标条目的 ID、标题，也不包含无权访问者的名单，避免把条目信息透露给无权访问的成员。具体的 `memberIds` 只在发起者收到的 `error` 中给出。
- 房间快照增加 `pendingChange`：没有切换在核对时为 null，否则为 `{changeId, memberId}`。重连的客户端据此知道仍在切换中。
- **兜底：** 客户端在收到 `CHANGE_IN_PROGRESS` 或 `pending` 后 10 秒内没有收到结束通知时，用 `GET /rooms/{roomId}` 重新读取快照。服务端的权限核对单次超时为 5 秒，正常情况下 10 秒内一定会结束。

**leadMs**（让所有人同时开始的提前量）：`clamp(1.5 × 在线成员最近上报的最大 rttMs + 150, 300, 1200)` 毫秒。没有 rtt 数据时用 600。

### 状态上报（客户端 → 服务端）

```json
{"type":"status","revision":13,"state":"ready","positionMs":734500,"rttMs":38,"sampledAt":1834570.12}
```

- `state` 取值同成员对象的 `status`；`sampledAt` 是客户端换算到服务端时间轴的采样时刻；`rttMs` 是客户端最近测得的往返时间。
- 所有字段必填：`revision` 为正安全整数，`positionMs` 和 `sampledAt` 为非负有限数，`rttMs` 在 0–60000 范围。位置超过影片时长时按时长处理。清除 lagging 还要求 `sampledAt` 与当前服务端时间差不超过 10 秒；过旧的采样不能证明已经追上。
- `revision` 是客户端已经应用的房间版本，按它分三种情况处理：
  - 等于当前版本：正常处理。
  - 小于当前版本（客户端还没收到最新的 `state`）：只更新心跳和 `rttMs`，不改变成员的显示状态，不参与等待和缓冲计时。
  - 大于当前版本：回复 `INVALID_REQUEST` 并忽略。
- `away` 和 `error` 不依赖版本：无论 revision 是多少都更新显示状态，并把成员移出等待名单。
- 状态变化时立即发送，播放中每 2 秒发送一次，每连接最多每秒 4 条。不需要回复。
- 服务端据此处理等待和成员显示。成员的 `status`、`connection`、`lagging` 变化时，向全房间广播 `members`；只有位置变化时不广播。同一房间每秒最多广播 2 次 `members`，合并期间的变化。
- 偏差由客户端自己计算，服务端不需要纠正成员位置。

### 等待规则

进入等待（`seek`、`changeItem`、缓冲触发）时，`waiting.memberIds` 包括所有在线、状态不是 `away` 或 `error`、且 `lagging=false` 的成员。

**哪些变化增加 revision：** 只有播放状态或媒体本身变化才加 1，即：
- 创建（版本 1）；
- 被接受的 `pause`、`seek`，以及让房间从暂停或等待变为播放的 `play`；
- `changeItem` 提交；
- 缓冲触发进入等待；
- 等待结束（`resume`、`timeout`）。

等待名单缩短、成员加入或离开、状态显示、lagging 标记和房主转移都**不**增加 revision。所以同一次等待中，每个人上报的 `ready` 都带同一个 revision，不会因为别人先就绪而失效。

- **就绪：** 成员上报 `status`，其中 `state="ready"`，且 `revision` 等于当前版本，即从名单中移除。
  - 名单变化时，服务端向全房间发送 `{"type":"waiting","revision":13,"memberIds":[...],"deadline":1834582.25}`，客户端据此显示「还在等 XX」。同一房间每秒最多发 4 次，合并期间的变化。
  - 名单清空时，状态变为 `playing`，`positionMs` 为等待位置，`serverTime = 当前时间 + leadMs`，`lastAction.type="resume"`，版本加 1 并广播 `state`。
- 到达 `deadline` 仍未就绪的成员被标为 `lagging=true`，房间按上面的方式开始播放，`lastAction.type="timeout"`。lagging 成员就绪后由客户端自行跳到应处位置追上；之后上报 `playing` 且位置与房间偏差在 1 秒以内时，服务端清除 lagging。下一次 `changeItem` 也会清除所有 lagging。
- 在等待中断线、变为 `away` 或 `error` 的成员，从列表中移除。
- **缓冲触发：** 房间在播放时，成员连续上报 `buffering` 达 1.5 秒，且该成员不是 lagging，且 30 秒内没有因他触发过等待时，房间进入 `waiting`。计时规则：
  - 只计 `revision` 等于当前版本的 buffering 上报。服务端从该成员在当前版本的第一条 buffering 开始计时。
  - 该成员之后上报任何非 buffering 状态，或房间版本变化，计时都清零。
  - 所以上一集或上一个版本留下的缓冲上报，不会触发新一集的等待。

  进入等待后：
  - 位置取该成员上报的 `positionMs`，但不超过房间当前的应处位置，让其他人退回到他卡住的地方，谁都不漏看内容；
  - `lastAction = {type:"buffer", memberId: 该成员}`，客户端显示「等待 XX 缓冲」。

  同一成员 30 秒内再次缓冲时不再让全房间等待，直接标为 `lagging`。

### 成员与房主操作

- `leave {requestId}`：与 REST 离开相同，完成后关闭连接（1000）。
- `kick {requestId, memberId}`（仅房主）：被踢者收到 `closed {reason:"kicked"}` 并以 4410 关闭，座位释放，在这个房间存在期间不能再加入。不是房主时返回 `NOT_OWNER`。
- `close {requestId}`（仅房主）：所有人收到 `closed {reason:"room_closed"}`，以 1000 关闭，房间结束。

leave/close 以 `closed` 和连接关闭表示完成，不另发 ack。kick 成功给房主返回 ack（带当前 revision），不会因为踢人本身增加 revision；被踢人恰为最后一个等待者时，等待结束会正常增加 revision。不能踢自己，不存在的 memberId 返回 `INVALID_REQUEST`。

### 断线与座位

「成员」包括在线成员和保留座位中的断线成员。成员只有在主动离开、被踢、会话失效或座位过期时才被移出。

- **有人在线时：**
  - 断线成员保留座位 `seatHoldSeconds`，期间 `connection="reconnecting"`，可以用 `/rooms/{roomId}/tickets` 或用房间码重新加入来重连。
  - 计时从断线时刻开始，到期仍未重连则移出。
- **所有成员都断线时：**
  - 房间进入休眠，**暂停所有座位计时，也不转移房主**。房间整体保留 `emptyRoomSeconds`，期间所有成员都还是成员，都可以申请票据重连。
  - 到期无人重连，房间结束。
- **休眠中有人重连后：** 房间恢复。其余仍断线的成员各自从这一刻重新获得完整的 `seatHoldSeconds`。
- **房主转移：** 房主被移出房间时（主动离开、会话失效，或在有人在线时座位过期），房主转给**当前在线**、加入最早的成员。
  - 房主只是断线、座位未过期时不转移。
  - 休眠期间座位不计时，所以也不会转移。
  - 房主被移出时如果没有人在线（例如休眠中会话复核失败），`ownerMemberId` 暂为 null，之后第一个重连的成员成为房主。
  - 转移通过 `members` 广播，不增加 revision。
  - 有人通过 `leaveCurrent` 离开时同样适用。
- **等待中的断线：** 断线成员立即从等待名单中移除（见「等待规则」），不等座位到期。

### 服务端 → 客户端消息

| type | 内容 | 时机 |
|---|---|---|
| `welcome` | 见上 | hello 成功后 |
| `state` | `{revision, media, playback}` | 每次版本变化，发给所有在线成员 |
| `members` | `{members, ownerMemberId}` | 成员加入、离开、状态、连接、房主变化 |
| `waiting` | `{revision, memberIds, deadline}` | 等待名单变化，不增加 revision |
| `itemChange` | `{phase, changeId, memberId, revision?, reason?}` | 切换开始核对，以及切换提交或放弃 |
| `ack` | `{requestId, revision}` | 控制命令被接受 |
| `error` | `{requestId?, code, message, room?, memberIds?, retryAfterMs?}` | 命令被拒绝或消息无效；连接保持 |
| `pong` | 见上 | 每个 ping |
| `closed` | `{reason}` | 关闭前最后一条，reason 见下表 |

### 关闭码

| 关闭码 | reason | 客户端行为 |
|---|---|---|
| 1000 | `left` / `room_closed` / `room_expired` | 正常结束，提示房间已结束或已离开 |
| 1012 | `room_closed` | 当前实现关停服务；重新申请票据时房间已不存在会得到 404 `ROOM_ENDED` |
| 1009 | 无 | 消息过大，属于客户端错误，记录日志后重连 |
| 4400 | `protocol_error` | 协议错误或未知 protocol 版本，不自动重连 |
| 4401 | `auth_failed` / `auth_expired` | 票据或登录失效，刷新登录后重新申请票据 |
| 4408 | `heartbeat_timeout` | 网络中断，申请新票据重连 |
| 4409 | `replaced` | 同一用户在别处连接，不自动重连，提示「已在其他设备加入」 |
| 4410 | `kicked` | 已被移出房间，不重连 |
| 4429 | `rate_limited` | 反复超限，等待后重连 |

第三版列出的 1001、4403、4404 保留为客户端兼容值，当前后端不主动发送：Origin 在 HTTP 握手前以 403 拒绝，已结束房间在 REST 申请票据时 404，过期票据 hello 使用 4401。帧过大时 ws 库以 1009 关闭，可能没有 closed JSON；异常断网也可能只看到本地 1006。不要以一定收到 closed 作为释放 UI 的前提。

## 限额

- **控制命令：** 每成员每 2 秒最多 5 条、每分钟最多 60 条。超出时回复 `RATE_LIMITED` 并带 `retryAfterMs`，命令丢弃；一分钟内超限 3 次以上以 4429 关闭。
- **status 与 ping：** 每连接每秒各最多 4 条。超过 16 KiB 的帧以 1009 关闭。
- **REST：**
  - 创建房间：每用户每分钟最多 5 次；
  - 加入：每用户每分钟最多 10 次，每 IP 每分钟最多 30 次，防止猜房间码；
  - 申请票据：每用户每分钟最多 30 次。
  - 超出返回 429 和 Retry-After 秒数。
- **房间总数：** 同时存在的房间达到 `maxRooms` 时，创建返回 503 `WATCH_CAPACITY`。房间存在超过 `maxRoomHours` 后以 1000 `room_expired` 结束。

额外资源保护（当前实现固定）：

| 项目 | 限制 / 结果 |
|---|---|
| 全部 watch HTTP 请求 | 每实际连接来源 IP 300 次/分钟；不信任转发 IP 头 |
| 同时处理 HTTP | 64；满额返回 503 `WATCH_CAPACITY` |
| HTTP 整体期限 | 20 秒；会中断未收完整的请求体，客户端可能看到连接断开 |
| REST 身份验证 | 最长 8 秒；媒体核对每轮最长 5 秒 |
| WS Upgrade | 每 IP 60 次/分钟；超限在握手时 HTTP 429 |
| 尚未 hello 的 WS | 全局 64、每 IP 8；满额握手 HTTP 503 |
| WS 消息总量 | 每连接每秒最多 32 条，另叠加 ping/status/命令各自限额 |
| WS 在途命令 | 每连接最多 4 条；超出 `RATE_LIMITED` |
| 连接发送积压 | 大于 64 KiB 时以 4408 关闭慢连接，保护其他成员 |
| 未使用票据 | 全局最多 10000，30 秒到期；满额 503 `WATCH_CAPACITY`，不改变旧房间成员身份 |
| 创建幂等记录 | 最多 20000，10 分钟后释放；满额阻止新建 |
| 房间码隔离记录 | 最多 100000，24 小时后释放；满额阻止新建 |

已关闭连接最多等待 250 ms 完成关闭握手，再强制释放。身份复核和媒体权限请求都不能阻塞其他房间的 100 ms 周期计时；网络延迟仍可能影响客户端实际收到消息的时刻。重复创建、重复加入、失败请求也可能计入相应限额，不应无间隔重试。

**房间码：** 6 位，取自 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`（31 个字符，不含 0、1、I、L、O）。在活动房间中唯一；已结束房间的码 24 小时内不复用。房间码可以猜测，安全性依赖加入限流与人数上限，所以日志中只记 roomId，不记房间码。

## 错误码

REST 返回 HTTP 状态和 code；WebSocket 的 `error` 消息只有 code。

| HTTP / code | 含义与客户端处理 |
|---|---|
| 400 `INVALID_REQUEST` | 参数、UUID、位置或消息格式错误 |
| 405 `METHOD_NOT_ALLOWED` | HTTP 方法不匹配 |
| 413 `BODY_TOO_LARGE` | REST 请求体超过 16 KiB |
| 415 `UNSUPPORTED_MEDIA_TYPE` | 正文不是 JSON，或携带不支持的 Content-Encoding |
| 401 `AUTH_REQUIRED` / `AUTH_INVALID` | 缺少或失效的登录，刷新登录后再试 |
| 401 `TICKET_INVALID` | 票据无效、过期或已用过（WebSocket 以 4401 关闭） |
| 403 `SERVER_NOT_ALLOWED` | 不是大河 Emby，客户端不显示一起看入口 |
| 403 `FORBIDDEN` | Origin 不允许 |
| 403 `ITEM_FORBIDDEN` | 自己无权访问房间当前的条目 |
| 403 `KICKED` | 已被这个房间踢出 |
| 403 `NOT_OWNER` | 只有房主能踢人和解散 |
| 404 `NOT_FOUND` / `ROOM_NOT_FOUND` | 房间码无效，或不是该房间成员 |
| 404 `ROOM_ENDED` | 房间已结束 |
| 409 `ROOM_FULL` | 人数已满 |
| 409 `ALREADY_IN_ROOM` | 已在其他房间，附 activeRoom；用户确认后带 leaveCurrent 重试 |
| 409 `IDEMPOTENCY_CONFLICT` | 同一 clientRequestId 内容不同 |
| 409 `STALE_REVISION` | 别人刚刚操作，附最新 room，按最新状态处理 |
| 409 `MEMBER_ITEM_FORBIDDEN` | 有成员无权访问目标条目，附 memberIds |
| 409 `ROOM_CHANGED` | 媒体反复变化，或旧创建/加入请求被该用户较新的成员操作取代；先重读 /me 与快照再决定是否重试 |
| 409 `INITIATOR_LEFT` | 切集发起者已失去本房间成员资格；其他成员收到 itemChange cancelled，已关闭的发起者不会再收到 error |
| 409 `CHANGE_IN_PROGRESS` | 已有一次切换正在核对权限；等待 `itemChange` 的 committed 或 cancelled，10 秒未收到则重新读取快照 |
| 422 `ITEM_TYPE_UNSUPPORTED` / `MEDIA_SOURCE_INVALID` | 不是电影或单集，或媒体源不属于该条目 |
| 422 `UNSUPPORTED_TYPE` | 未知的 WebSocket 消息类型，连接保持 |
| 429 `RATE_LIMITED` | 遵守 Retry-After 或 retryAfterMs |
| 503 `WATCH_UNAVAILABLE` / `WATCH_CAPACITY` / `AUTH_UNAVAILABLE` | 服务、房间容量或 Emby 身份校验暂不可用，显示暂不可用 |

## 客户端接入顺序与播放处理

1. 复用评论服务主机选择规则；GET `/health` 确认可用，再带三个身份头 GET `/me`。
2. 新建/加入成功后立即用同一 clientId 和票据建立 WS，5 秒内 hello；不要把 Token 或票据放在 URL。
3. 以 welcome.room 初始化媒体与成员，校时后执行播放状态；服务端不会返回视频流地址，各成员自行向 Emby 获取可播放地址。
4. 收到 state 更新媒体/播放；members 更新成员；waiting 只更新同一 revision 的剩余名单；itemChange 更新切集忙碌指示。不要用晚到的旧 waiting 覆盖新 state。
5. 网络中断后先申请新票据，收到 welcome 后以完整快照恢复；4409/4410 不自动重连。404 ROOM_ENDED/NOT_FOUND 清理本地房间状态。
6. 退出房间优先 POST `/leave` 或 WS leave；仅关闭播放器上报 away，不能等同于退出房间。

头像 `avatarPath` 可以为 null；存在时相对评论服务主机解析，按现有 `/community/v1/avatars` 鉴权加载。不要把作者 ID 转换为 Emby 用户头像路径。

- **校时：** 客户端用最近 8 次 ping 中往返最短的一次估算两边时钟差，持续用 ping 更新。
- **执行状态：** 收到 `state` 后按快照执行。
  - 暂停：对齐到 positionMs。
  - 播放：在 serverTime 那一刻从 positionMs 开始。
  - 等待：跳到等待位置，缓冲好后上报 `ready`。
- **持续校正：** 播放中客户端比较实际位置与应处位置：
  - 偏差小于 50 毫秒：不处理；
  - 50 毫秒到 2 秒：在 0.95–1.05 倍之间短暂调整播放速度追平；
  - 超过 2 秒：直接跳转。
  - 这些校正不发命令、不改变房间版本。
- **本地操作：** 用户在任何控件上（网页、MPV 快捷键、Android 原生控制栏、iPad 原生界面）暂停或拖动时，客户端先在本地执行，再发送命令。由同步引起的暂停和跳转不会作为命令再发出。
- **其他：** 关闭播放器或 Android 进入后台时上报 `away`，不暂停房间。断线后自动申请票据重连，用 welcome 中的快照恢复。

## 扩展预留（第一版不实现）

- **能力协商：** `welcome.features` 列出服务端已启用的功能，`hello.capabilities` 列出客户端支持的功能；双方都支持时才使用。未知消息类型回复 `UNSUPPORTED_TYPE` 并保持连接，便于逐步上线。第一版不要使用以 `chat.`、`rtc.`、`voice.` 开头的消息类型。
- **聊天：**
  - 预计为 `chat.send {requestId, clientMessageId, text}` → 广播 `chat.message {messageId, memberId, text, serverTime}`。
  - 只在房间存在期间临时保存；评论禁言的用户不能发送。
  - 正文和限流规则另行确定。
- **语音（WebRTC）：**
  - 4 人房间可用点对点互连：
    - 信令走同一通道 `rtc.signal {to: memberId, payload}`，服务端只在同房间成员之间转发，`payload` 不解析，最大 64 KiB；
    - 麦克风状态用 `rtc.state {micOn, speaking}` 广播。
  - 外网用户之间需要 TURN 中转：在 .150 部署 coturn 一类服务，由 `POST /rooms/{roomId}/turn-credentials` 发放 1 小时内有效的临时凭据（TURN REST 方式）。
  - 20 人房间不适合点对点，需要媒体转发服务器（SFU，例如 LiveKit），届时由 `voice.join` 返回其地址和令牌。
  - 语音会额外占用服务器上行带宽，具体方案届时再定。
- **消息中心邀请：**
  - 预计为 `POST /rooms/{roomId}/invites {authorIds}`，在 `/community/v1/me/messages` 中新增 `watch_invite` 类型，带房间、媒体位置、邀请人和过期时间。
  - 接收者仍需通过加入时的权限检查。

## 日志与隐私

- **不记录：** Token、票据、房间码、请求头。
- 当前实现不写入房间/成员/命令业务日志，也不把 watch 请求计入弹幕调用统计。未来可增加脱敏指标，但本文不承诺已经提供房间管理查询或审计接口。
- **不保存：** 房间历史和成员观看记录不落盘；房间结束后清理成员及会话，只保留有时限的幂等、房间码隔离和限流元数据。
- **观看进度：** 仍由各客户端照常回报给 Emby，服务端不代为写入。

## 对接验收清单

1. 认证：三个身份头校验，非大河 ServerId、API Key、他人 Token 拒绝；Origin 白名单（REST 与 WebSocket 握手）。
2. 管理员容量：管理员账号创建得到 20，普通账号得到 4；客户端无法通过参数改变容量。
3. 创建：条目类型、访问权限、媒体源归属、位置范围检查；clientRequestId 幂等与冲突。
4. 加入：
   - 房间码大小写；
   - 已是成员时先返回票据，不受满员影响；
   - 被踢、满员（含保留座位）、无权访问；
   - 已在其他房间时的 `ALREADY_IN_ROOM`，以及目标检查失败时优先返回目标的错误；
   - `leaveCurrent` 只在目标全部检查通过后离开旧房间，目标失败时旧房间成员身份不变（创建房间同样）；
   - 提交前复核：验权期间房间切换条目时，对新条目重新验权；失败返回 ITEM_FORBIDDEN 且不占座位、不离开旧房间；反复切换返回 ROOM_CHANGED；验权期间房间坐满返回 ROOM_FULL。
5. 票据：单次使用、30 秒过期；REST 签发时绑定 clientId，hello 的 clientId 不同时 4401；5 秒内未 hello 关闭；票据不出现在日志。
6. 同一用户第二个连接取代第一个（4409），memberId 不变。
7. ping/pong 时间戳来自单调时间轴且不倒退；20 秒无消息关闭（4408）。
8. 控制命令：STALE_REVISION 拒绝且不改状态；pause 立即生效；play 的 serverTime 在将来且符合 leadMs；seek 在暂停和播放时的不同结果。
9. 等待：
   - 全部 ready 后开始；
   - 名单缩短时发送 `waiting`，不增加 revision，后到的 ready 仍有效；
   - 超时后开始并标记 lagging；
   - 断线、away、error 成员移出等待；
   - lagging 清除条件。
10. status 版本：
    - 旧版本上报不改显示状态、不参与等待和缓冲计时；
    - 新于当前的版本回复 INVALID_REQUEST；
    - away/error 不受版本限制。
11. 缓冲触发：
    - 1.5 秒阈值；
    - 只计当前版本、版本变化清零；
    - 位置不超过房间应处位置；
    - 30 秒内同一成员不重复触发。
12. changeItem：
    - 逐成员权限核对，有人无权访问时拒绝并返回 memberIds；
    - 核对中再次切换返回 CHANGE_IN_PROGRESS；
    - 核对期间有人操作播放或有新成员加入，提交时返回 STALE_REVISION 且状态不变；
    - 核对期间发起者以外的人离开不影响提交，其失败的核对结果也不再阻塞；发起者离开、被踢或座位过期时放弃（INITIATOR_LEFT）；房间结束时放弃；
    - 每次切换先发一条 itemChange pending，最终恰好一条 committed 或 cancelled，通知中不含条目信息；
    - 快照中的 pendingChange 与核对状态一致；
    - 并发自动下一集只有一个生效。
13. 断线与座位：
    - 有人在线时座位按 seatHoldSeconds 计时；
    - 全部断线时暂停座位计时、不转移房主，房间保留 emptyRoomSeconds 且所有成员可重连；
    - 有人重连后其余断线成员重新计时；
    - 房主转移只给在线成员，无人在线时房主暂缺；
    - 最后一名成员离开立即结束。
14. 房主踢人与解散；非房主返回 NOT_OWNER。
15. 会话复核：每 10 分钟检查，收到明确的会话失效结果后移出（4401）；暂时不可用不能误判成注销，复核不阻塞其他计时。
16. 限额：命令、status、ping、帧大小、REST 加入的用户与 IP 限流、maxRooms。
17. 服务重启：房间消失，重连得到 ROOM_ENDED。

## 线上验证与后续联调

- 2026-10-15 21:37–21:39 已使用现有有效的普通用户和 Emby 管理员会话，验证所有七个 REST 路径及真实 WebSocket 房间流程：建房、幂等、加入、取票据、读快照、离开、播放/暂停/拖动、等待就绪恢复、切换另一个真实媒体条目、旧 revision 拒绝、旧票据拒绝、同用户连接替换4409、非房主拒绝、踢人4410及禁止重入、解散后 ROOM_ENDED。
- 匿名、他人 Token 冒用、外服 ServerId、拒绝的 Origin 均按契约拒绝；允许的浏览器预检204。配置、原评论等业务记录保留，缓存和评论数据库完整性/外键检查通过。测试房间已释放，未写测试评论或 Emby 播放进度。
- 21:39 另行核对92个运行文件与清单一致、64文件旧版备份可校验；局域网与公网域名的健康及 WS Upgrade 验证通过。以上网络检查都从 NAS 发起，尚不能证明其他网络运营商的公网连通性。
- 后端现可供客户端接入。接下来用正式客户端验收实际音视频同步：
  - 在同一台电脑上开两个隔离配置的客户端加入同一房间。时钟相同，可以准确量出两边进度差。
  - 再加一个通过 `nas.tigerest.top` 外网连接的设备。
- 联调使用测试房间，结束后解散，不在生产评论区或消息中心留下内容。
