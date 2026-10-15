# 一起看服务端 API（v1）

状态：2026-10-15 客户端提出的后端契约，尚未实现。供后端在评论／弹幕服务（HTTP 18443，独立私有仓库）中实现，客户端按本文对接。任何一方需要改动协议时，先更新本文再改代码。

## 目标与范围

- 大河专属 Emby（ServerId `62526c3bf747439c99327ddec5fed4a8`）的登录用户可以创建房间，用房间码邀请其他大河用户，以相同的进度观看同一部电影或同一集。
- **房间内所有成员都能控制**：播放、暂停、拖动进度、切换剧集，不区分房主和成员的控制权。房主只多出踢人和解散房间。
- **人数上限（含创建者）：** 普通用户创建的房间最多 4 人；创建者是大河 Emby 管理员（目前即 Tigerest 账号）时最多 20 人。
- 第一版不做：房间聊天、语音、消息中心邀请、公开房间列表、自建 Emby 用户加入。协议为聊天和语音预留了扩展位置（见「扩展预留」），第一版实现时不要占用这些消息类型。

服务端是房间状态的唯一来源：保存房间的媒体、播放状态和时间锚点，按到达顺序处理成员的操作并广播。服务端不转发、不代理视频流；每个成员仍各自从 Emby 拉流，各自向 Emby 回报观看进度。

## 部署与地址

- 与评论、弹幕在同一进程和端口。局域网 `http://192.168.5.150:18443/watch/v1`，外网 `http://nas.tigerest.top:18443/watch/v1`。客户端按评论服务的同一规则选择主机：Emby 地址主机为 `192.168.5.150` 时用局域网地址，否则用 `nas.tigerest.top`。
- 实时通道：`ws://<同一主机>:18443/watch/v1/socket`。如果 18443 前面有反向代理或端口转发设备，需要放行 WebSocket Upgrade，空闲超时不低于 60 秒。
- 房间状态只保存在内存，不写数据库。服务重启后所有房间结束；客户端重连时申请票据得到 404 `ROOM_ENDED`，提示「房间已结束」。

私有配置建议（名称可按现有配置风格调整，默认值以本文为准）：

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
- **管理员判定：** 创建房间时，服务端用创建者自己的会话向 Emby 读取 `GET /Users/{userId}` 的 `Policy.IsAdministrator`，为 true 时容量为 `adminRoomCapacity`。客户端不能自行声明。容量在创建时确定，之后房主转移也不变。

### WebSocket 票据

浏览器的 WebSocket 不能带自定义请求头，Token 也不能写进 URL，所以实时通道使用一次性票据：

1. 客户端带身份头调用 REST 创建房间、加入房间或申请票据，得到 `ticket`。
2. 客户端连接 `/watch/v1/socket`。握手时检查 Origin 白名单，不通过返回 403。
3. 连接后第一条消息为 `hello`，携带票据。

票据为至少 128 位的随机值，单次使用，30 秒内有效，绑定用户、房间和 hello 中的 `clientId`。连接后 5 秒内未收到 `hello`，或票据无效、过期、已用过，关闭连接，关闭码 4401。票据不写入任何日志。

### 会话复核

成员在线期间，服务端在进程内存中保留该成员签发票据时使用的 Emby Token：不落盘、不写日志，成员离开房间或座位过期时立即丢弃。用途只有两个：

- 每 10 分钟复核一次会话仍然有效（可复用现有 30 秒身份缓存）。失效时发送 `closed {reason:"auth_expired"}` 并以 4401 关闭，成员移出房间。
- 切换媒体时，用每个成员自己的会话核对能否访问新条目（见 `changeItem`）。

## 房间快照

```json
{
  "roomId": "房间 UUID",
  "code": "7KQ2MZ",
  "capacity": 4,
  "createdAt": "2026-10-15T12:00:00.000Z",
  "ownerMemberId": "成员 UUID",
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

| 方法、路径 | 请求 | 返回 data |
|---|---|---|
| GET `/health` | 无认证 | `{status, enabled, protocol: 1}`，可用 200，否则 503 |
| GET `/me` | 认证 | `{author, capacity, activeRoom, features}` |
| POST `/rooms` | `{itemId, mediaSourceId, positionMs, clientRequestId, leaveCurrent?}` | 首次 201，重试 200：`{room, ticket, ticketExpiresAt, replayed}` |
| POST `/rooms/join` | `{code, leaveCurrent?}` | `{room, ticket, ticketExpiresAt}` |
| POST `/rooms/{roomId}/tickets` | 无请求体 | `{ticket, ticketExpiresAt}` |
| POST `/rooms/{roomId}/leave` | 无请求体 | `{left: true}`，幂等 |
| GET `/rooms/{roomId}` | 认证 | `{room}` |

- **GET /me：** `capacity` 是该用户现在创建房间时的人数上限（4 或 20）。`activeRoom` 为 `{roomId, code, title}` 或 null，客户端据此在启动后恢复房间。`features` 第一版为 `["sync"]`。
- **POST /rooms：**
  - 条目类型只接受 `Movie` 和 `Episode`，其他返回 422 `ITEM_TYPE_UNSUPPORTED`。
  - 用创建者自己的会话确认能访问该条目，`mediaSourceId` 属于该条目，`positionMs` 在 0 到时长之间。
  - 初始状态为 `paused`、`revision=1`、`lastAction.type="create"`，创建者为房主。
  - `clientRequestId` 为 UUID，10 分钟内幂等：相同 ID 和内容重试时，若房间仍在，返回同一房间和一张新票据；相同 ID 改了内容返回 409 `IDEMPOTENCY_CONFLICT`。
- **POST /rooms/join：**
  - 房间码不区分大小写，去掉首尾空白。
  - 依次检查：房间存在且未结束，否则 404 `ROOM_NOT_FOUND`；没有满员（断线保留中的座位也计入），否则 409 `ROOM_FULL`；没有被踢出，否则 403 `KICKED`；用加入者自己的会话能访问当前条目，否则 403 `ITEM_FORBIDDEN`。
  - 通过后占用座位，并在 `members` 广播中出现，`connection` 为 `reconnecting`，直到 WebSocket 的 hello 完成。票据过期而未连接时，按座位保留规则处理。
- **一人只能在一个房间：** 已在其他房间时，创建和加入都返回 409 `ALREADY_IN_ROOM`，`error` 中附带 `activeRoom`。客户端询问用户后，带 `leaveCurrent: true` 重试；服务端先原子地离开旧房间，再创建或加入。重复加入自己已在的房间不算冲突，直接返回新票据。
- **POST /rooms/{roomId}/tickets：** 只有本房间的成员（包括保留座位期间的断线成员）可以申请，用于重连。房间已结束返回 404 `ROOM_ENDED`；不是成员返回 404 `NOT_FOUND`，不透露房间是否存在。
- **POST /rooms/{roomId}/leave：** 移出成员并释放座位。房主离开时，房主转给仍在线、加入最早的成员。最后一个成员主动离开时房间立即结束。
- **GET /rooms/{roomId}：** 只有成员可读，否则 404 `NOT_FOUND`。

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

### 校时与心跳

客户端发送 `{"type":"ping","id":17,"t0":123456.7}`，`t0` 是客户端自己的时钟，服务端原样返回。服务端立即回复：

```json
{"type":"pong","id":17,"t0":123456.7,"serverReceive":1834567.25,"serverSend":1834567.31}
```

两个时间取自同一条单调时间轴。pong 应尽量不排在大批广播之后发出，回复越快，客户端校时越准。客户端连接后先连续发送数次，之后每 5 秒一次；ping 同时充当心跳。服务端 20 秒内没有收到该连接的任何消息时，以 4408 关闭。

### 控制命令（任何成员）

`pause`、`play`、`seek`、`changeItem` 都带 `requestId` 和 `baseRevision`（客户端当前看到的版本）。

- `baseRevision` 不等于当前版本时拒绝，状态不变，回复 `error {code:"STALE_REVISION", room}`。这表示别人刚刚抢先操作了，客户端按最新状态处理并提示用户。这样同时操作的两个人不会互相覆盖。
- 接受时版本加 1，向全房间（包括操作者）广播 `state`，并给操作者回复 `{"type":"ack","requestId":"...","revision":13}`。
- 所有 `positionMs` 截断到 0 到 `media.runTimeMs` 之间。

各命令：

- `pause {positionMs}`：状态改为 `paused`，位置为操作者给出的 `positionMs`，立即生效。操作者的客户端已在本地先暂停，其他人收到后暂停并对齐到这个位置。房间在 `waiting` 时同样可以暂停，等待随之取消。
- `play {}`：从 `paused` 或 `waiting` 开始播放，`state=playing`，`positionMs` 为当前停住的位置，`serverTime = 当前服务端时间 + leadMs`（见下）。房间已在播放时直接回复 ack，不加版本。
- `seek {positionMs}`：
  - 房间暂停时：仍为 `paused`，位置改为新位置。
  - 房间在播放或等待时：进入 `waiting`，位置为新位置，`resumeTo="playing"`，`memberIds` 为参与等待的成员（见「等待规则」），`deadline = 当前时间 + waitTimeoutSeconds`。
- `changeItem {itemId, mediaSourceId, positionMs}`（`positionMs` 省略为 0）：
  - 条目类型和媒体源的检查同创建房间，用操作者的会话读取媒体信息。
  - 用每个成员（在线和保留座位中的）自己的会话并行核对能否访问新条目，单次超时 5 秒。有人无权访问时拒绝，回复 `error {code:"MEMBER_ITEM_FORBIDDEN", memberIds:[...]}`，状态不变。核对时 Emby 不可用，回复 503 等价的 `WATCH_UNAVAILABLE`。
  - 通过后替换 `media`，进入 `waiting`，`resumeTo="playing"`。剧集播完自动下一集也走这个命令。几个客户端同时发出时，因为都带同一个 `baseRevision`，只有第一个生效，其余收到 `STALE_REVISION` 后跟随。

**leadMs**（让所有人同时开始的提前量）：`clamp(1.5 × 在线成员最近上报的最大 rttMs + 150, 300, 1200)` 毫秒。没有 rtt 数据时用 600。

### 状态上报（客户端 → 服务端）

```json
{"type":"status","revision":13,"state":"ready","positionMs":734500,"rttMs":38,"sampledAt":1834570.12}
```

- `state` 取值同成员对象的 `status`；`sampledAt` 是客户端换算到服务端时间轴的采样时刻；`rttMs` 是客户端最近测得的往返时间。
- 状态变化时立即发送，播放中每 2 秒发送一次，每连接最多每秒 4 条。不需要回复。
- 服务端据此处理等待和成员显示。成员的 `status`、`connection`、`lagging` 变化时，向全房间广播 `members`；只有位置变化时不广播。同一房间每秒最多广播 2 次 `members`，合并期间的变化。
- 偏差由客户端自己计算，服务端不需要纠正成员位置。

### 等待规则

进入等待（`seek`、`changeItem`、缓冲触发）时，`waiting.memberIds` 包括所有在线、状态不是 `away` 或 `error`、且 `lagging=false` 的成员。

- 成员上报 `status`，其中 `state="ready"`，且 `revision` 等于当前版本，即从列表中移除。列表清空时，状态变为 `playing`，`positionMs` 为等待位置，`serverTime = 当前时间 + leadMs`，`lastAction.type="resume"`，版本加 1 并广播。
- 到达 `deadline` 仍未就绪的成员被标为 `lagging=true`，房间按上面的方式开始播放，`lastAction.type="timeout"`。lagging 成员就绪后由客户端自行跳到应处位置追上；之后上报 `playing` 且位置与房间偏差在 1 秒以内时，服务端清除 lagging。下一次 `changeItem` 也会清除所有 lagging。
- 在等待中断线、变为 `away` 或 `error` 的成员，从列表中移除。
- **缓冲触发：** 房间在播放时，成员连续上报 `buffering` 达 1.5 秒（服务端从该成员在当前版本收到的第一条 buffering 开始计时），且该成员不是 lagging，且 30 秒内没有因他触发过等待时，房间进入 `waiting`：
  - 位置取该成员上报的 `positionMs`，但不超过房间当前的应处位置，让其他人退回到他卡住的地方，谁都不漏看内容；
  - `lastAction = {type:"buffer", memberId: 该成员}`，客户端显示「等待 XX 缓冲」。

  同一成员 30 秒内再次缓冲时不再让全房间等待，直接标为 `lagging`。

### 成员与房主操作

- `leave {requestId}`：与 REST 离开相同，完成后关闭连接（1000）。
- `kick {requestId, memberId}`（仅房主）：被踢者收到 `closed {reason:"kicked"}` 并以 4410 关闭，座位释放，在这个房间存在期间不能再加入。不是房主时返回 `NOT_OWNER`。
- `close {requestId}`（仅房主）：所有人收到 `closed {reason:"room_closed"}`，以 1000 关闭，房间结束。
- **断线：** 保留座位 `seatHoldSeconds`，期间 `connection="reconnecting"`，客户端用 `/rooms/{roomId}/tickets` 重连。超时后移出成员，规则同离开。房主断线超过保留时间后，房主转给仍在线、加入最早的成员。所有成员都断线时房间保留 `emptyRoomSeconds`，期间无人重连则结束。

### 服务端 → 客户端消息

| type | 内容 | 时机 |
|---|---|---|
| `welcome` | 见上 | hello 成功后 |
| `state` | `{revision, media, playback}` | 每次版本变化，发给所有在线成员 |
| `members` | `{members, ownerMemberId}` | 成员加入、离开、状态、连接、房主变化 |
| `ack` | `{requestId, revision}` | 控制命令被接受 |
| `error` | `{requestId?, code, message, room?, memberIds?, retryAfterMs?}` | 命令被拒绝或消息无效；连接保持 |
| `pong` | 见上 | 每个 ping |
| `closed` | `{reason}` | 关闭前最后一条，reason 见下表 |

### 关闭码

| 关闭码 | reason | 客户端行为 |
|---|---|---|
| 1000 | `left` / `room_closed` / `room_expired` | 正常结束，提示房间已结束或已离开 |
| 1001 / 1012 | 无 | 服务重启或关闭，申请新票据重连；房间已不存在时得到 404 `ROOM_ENDED` |
| 1009 | 无 | 消息过大，属于客户端错误，记录日志后重连 |
| 4400 | `protocol_error` | 协议错误或未知 protocol 版本，不自动重连 |
| 4401 | `auth_failed` / `auth_expired` | 票据或登录失效，刷新登录后重新申请票据 |
| 4403 | `forbidden` | Origin 或服务器不允许，不重连 |
| 4404 | `room_ended` | 房间已结束 |
| 4408 | `heartbeat_timeout` | 网络中断，申请新票据重连 |
| 4409 | `replaced` | 同一用户在别处连接，不自动重连，提示「已在其他设备加入」 |
| 4410 | `kicked` | 已被移出房间，不重连 |
| 4429 | `rate_limited` | 反复超限，等待后重连 |

## 限额

- **控制命令：** 每成员每 2 秒最多 5 条、每分钟最多 60 条。超出时回复 `RATE_LIMITED` 并带 `retryAfterMs`，命令丢弃；一分钟内超限 3 次以上以 4429 关闭。
- **status 与 ping：** 每连接每秒各最多 4 条。超过 16 KiB 的帧以 1009 关闭。
- **REST：**
  - 创建房间：每用户每分钟最多 5 次；
  - 加入：每用户每分钟最多 10 次，每 IP 每分钟最多 30 次，防止猜房间码；
  - 申请票据：每用户每分钟最多 30 次。
  - 超出返回 429 和 Retry-After 秒数。
- **房间总数：** 同时存在的房间达到 `maxRooms` 时，创建返回 503 `WATCH_CAPACITY`。房间存在超过 `maxRoomHours` 后以 1000 `room_expired` 结束。

**房间码：** 6 位，取自 `23456789ABCDEFGHJKMNPQRSTUVWXYZ`（31 个字符，不含 0、1、I、L、O）。在活动房间中唯一；已结束房间的码 24 小时内不复用。房间码可以猜测，安全性依赖加入限流与人数上限，所以日志中只记 roomId，不记房间码。

## 错误码

REST 返回 HTTP 状态和 code；WebSocket 的 `error` 消息只有 code。

| HTTP / code | 含义与客户端处理 |
|---|---|
| 400 `INVALID_REQUEST` | 参数、UUID、位置或消息格式错误 |
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
| 422 `ITEM_TYPE_UNSUPPORTED` / `MEDIA_SOURCE_INVALID` | 不是电影或单集，或媒体源不属于该条目 |
| 422 `UNSUPPORTED_TYPE` | 未知的 WebSocket 消息类型，连接保持 |
| 429 `RATE_LIMITED` | 遵守 Retry-After 或 retryAfterMs |
| 503 `WATCH_UNAVAILABLE` / `WATCH_CAPACITY` / `AUTH_UNAVAILABLE` | 服务、房间容量或 Emby 身份校验暂不可用，显示暂不可用 |

## 客户端如何使用（供后端理解，不是后端要求）

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
- **可记录：** 房间创建和结束、成员加入和离开（authorId）、命令类型和计数、错误码、等待和超时次数、连接时长。
- **不保存：** 房间历史和成员观看记录在房间结束后不保留，只保留运维日志中的上述条目。
- **观看进度：** 仍由各客户端照常回报给 Emby，服务端不代为写入。

## 后端验收清单

1. 认证：三个身份头校验，非大河 ServerId、API Key、他人 Token 拒绝；Origin 白名单（REST 与 WebSocket 握手）。
2. 管理员容量：管理员账号创建得到 20，普通账号得到 4；客户端无法通过参数改变容量。
3. 创建：条目类型、访问权限、媒体源归属、位置范围检查；clientRequestId 幂等与冲突。
4. 加入：房间码大小写、满员（含保留座位）、被踢、无权访问、已在其他房间及 leaveCurrent。
5. 票据：单次使用、30 秒过期、绑定 clientId、5 秒内未 hello 关闭、不出现在日志。
6. 同一用户第二个连接取代第一个（4409），memberId 不变。
7. ping/pong 时间戳来自单调时间轴且不倒退；20 秒无消息关闭（4408）。
8. 控制命令：STALE_REVISION 拒绝且不改状态；pause 立即生效；play 的 serverTime 在将来且符合 leadMs；seek 在暂停和播放时的不同结果。
9. 等待：全部 ready 后开始；超时后开始并标记 lagging；断线和 away 成员移出等待；lagging 清除条件。
10. 缓冲触发：1.5 秒阈值、位置不超过房间应处位置、30 秒内同一成员不重复触发。
11. changeItem：逐成员权限核对，有人无权访问时拒绝并返回 memberIds；并发自动下一集只有一个生效。
12. 离开和断线：房主转移、座位保留与过期、最后一人离开立即结束、全部断线后保留 emptyRoomSeconds。
13. 房主踢人与解散；非房主返回 NOT_OWNER。
14. 会话复核：Emby 会话失效后 10 分钟内移出（4401）。
15. 限额：命令、status、ping、帧大小、REST 加入的用户与 IP 限流、maxRooms。
16. 服务重启：房间消失，重连得到 ROOM_ENDED。

## 联调

- 客户端先用本机的模拟服务（按本文实现）开发和测试。
- 后端部署到局域网 18443 后：
  - 在同一台电脑上开两个隔离配置的客户端加入同一房间。时钟相同，可以准确量出两边进度差。
  - 再加一个通过 `nas.tigerest.top` 外网连接的设备。
- 联调使用测试房间，结束后解散，不在生产评论区或消息中心留下内容。
