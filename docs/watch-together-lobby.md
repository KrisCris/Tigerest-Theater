# 一起看服务端补充：先组房间再选片（lobby）

本文是 [watch-together-api.md](watch-together-api.md) 的增量，不改变现有任何行为。实现后在 `GET /me` 和 `welcome` 的 `features` 中加入 `"lobby"`，客户端看到这个标记才走新流程，否则继续用现在的方式。

## 为什么要加

客户端的入口已改成顶栏的「一起看」按钮，打开房间页：

1. 先建房间（不选片），把房间码发给别人；
2. 人到齐后，在房间页里一起选好这一集；
3. 点「开始放映」，房间页上的所有人一起进入播放器，都加载好以后同时开始。

现在的接口有两处做不到：

- 创建房间必须带影片；
- `changeItem` 提交后立刻进入 `waiting → playing`，选片和开播绑在一起，没法「先选好，大家看一眼，再开始」。

客户端目前的临时做法是：创建时先选片，「开始放映」发一条换成同一部片的 `changeItem`。这会对每个成员重新做一遍 Emby 权限核对，也会弹出「XX 换成了……」的提示，不是长久之计。

## 改动一：创建房间可以不带影片

`POST /rooms` 允许省略 `itemId`、`mediaSourceId`、`positionMs`：

```json
{"clientRequestId":"8188c854-4c72-42e9-859b-6f9675ae7c6d","clientId":"13f7e2be-ebcc-4016-b47f-063d45e3200d","leaveCurrent":false}
```

- `itemId` 和 `mediaSourceId` 要么都给、要么都不给；只给一个返回 400 `INVALID_REQUEST`。不带影片时也不能带 `positionMs`。
- 不带影片时，快照为 `media: null`，`playback = {revision:1, state:"paused", positionMs:0, serverTime:当前, rate:1, waiting:null, lastAction:{type:"create", memberId:创建者}}`。
- 幂等比较把省略的字段当作 null：同一 `clientRequestId` 先不带影片、重试时带了影片，返回 `IDEMPOTENCY_CONFLICT`。
- `GET /me` 的 `activeRoom.title` 在没有影片时为 null。
- 房间数、人数、存活时间等限额与有影片的房间相同。

`media` 为 null 时：

- **加入：** 跳过「能访问房间当前条目」（加入第 5 步）的核对。提交前复核时如果房间已经选了片，按现有规则对新条目核对。
- **pause / play / seek / start：** 回复 409 `NO_MEDIA`，状态和版本都不变。
- **status 上报：** 照常接受，`positionMs` 截断为 0。不触发缓冲等待。
- **changeItem：** 可以发，检查与现在相同。

## 改动二：changeItem 增加 `autoplay`

```json
{"type":"changeItem","requestId":"f4be0f09-5992-4a65-a05f-d1b35d7d603b","baseRevision":3,"itemId":"12346","mediaSourceId":"next-source","positionMs":0,"autoplay":false}
```

- `autoplay` 为可选的严格布尔值，省略等于 `true`，也就是现在的行为。
- `autoplay:false` 时，核对、竞态处理和 `itemChange` 通知全部照旧，只是提交那一步改为：
  - 替换 `media`；
  - 状态为 `paused`，位置为 `positionMs`，`waiting=null`；
  - `lastAction = {type:"changeItem", memberId:发起者}`；
  - 版本加 1，清除所有 lagging，广播 `state`。
- 房间正在播放时也可以这样换片：所有人停下，等下一次「开始放映」。

## 改动三：新命令 `start`（大家都加载好再一起开始）

```json
{"type":"start","requestId":"b9c9064d-dd5b-413f-b7aa-66da9c018fac","baseRevision":4,"positionMs":0}
```

- 任何成员都可以发。带 `requestId`、`baseRevision`，`baseRevision` 规则同其他控制命令；计入控制命令限额。
- `positionMs` 可选，省略时用房间当前位置；给了就截断到 0..时长。
- **房间为 `paused` 时：** 进入 `waiting`，位置为上面的位置，`resumeTo="playing"`。`memberIds` 按现有「等待规则」取在线、状态不是 `away`/`error`、不是 lagging 的成员；`deadline = 当前时间 + waitTimeoutSeconds`；`lastAction = {type:"start", memberId:发起者}`。版本加 1，广播 `state`，回 `ack`。
  - 名单清空、超时等后续处理与 `seek` 引起的等待完全相同：最后变为 `playing`，`lastAction` 为 `resume` 或 `timeout`。
  - 等待名单在进入时就是空的（例如只有发起者，且他还是 away），直接按「名单清空」处理。
- **房间已在 `playing` 或 `waiting` 时：** 直接回复 `ack`，不改状态、不加版本（同现在的 `play`）。
- **`media` 为 null 时：** 409 `NO_MEDIA`。
- `lastAction.type` 增加取值 `start`。

和 `play` 的区别：`play` 用 `leadMs` 直接定一个开始时刻，适合大家已经在播放器里暂停后的继续播放；`start` 先等所有人把播放器打开并缓冲好，适合从房间页一起进入播放。

房间页上的成员上报 `paused`，所以会被纳入等待名单；在别的页面闲逛的成员上报 `away`，不等他，他之后可以从房间页自己进入，按迟到者追上。

## 能力标记

- `GET /me` 和 `welcome` 的 `features` 为 `["sync","lobby"]`。
- 客户端在服务端声明了 `lobby` 时，`hello.capabilities` 带 `["sync","lobby"]`。服务端应接受未知或新增的能力字符串（现有校验：字符串数组，最多 16 项，每项最多 32 字符）。
- 服务端不需要根据客户端是否声明 `lobby` 改变行为：老客户端不会创建空房间。若老客户端加入了一个 `media` 为 null 的房间，它会显示「暂未选片」并等待 `state`。

## 错误码新增

| HTTP / code | 含义 |
|---|---|
| 409 `NO_MEDIA` | 房间还没有选片，不能播放、暂停、拖动或开始 |

## 验收清单

1. 不带影片创建 → 201，`media` 为 null，`paused`，revision 1；`/me.activeRoom.title` 为 null。
2. 只带 `itemId` 不带 `mediaSourceId`，或不带影片却带 `positionMs` → 400。
3. 同一 `clientRequestId` 重试不带影片 → 200 同一房间；改为带影片 → `IDEMPOTENCY_CONFLICT`。
4. 另一用户加入无片房间 → 成功，不向 Emby 核对条目。
5. 无片房间发 pause/play/seek/start → `NO_MEDIA`，版本不变；status 照常接受。
6. `changeItem` 带 `autoplay:false` → 收到 `itemChange pending`、`state`（`paused`、新 media、位置为给定值、版本加 1）、`itemChange committed`、`ack`；不进入 waiting。
7. `changeItem` 不带 `autoplay` → 行为与现在完全相同。
8. `autoplay` 传字符串 `"false"` → 400。
9. `paused` 时 `start` → `waiting`（`lastAction.type="start"`，名单为非 away 的在线成员）；所有人上报同版本 `ready` 后 → `playing`（`lastAction.type="resume"`）。
10. `start` 后有人一直不 ready → 到 deadline 标 lagging 并开始播放（`timeout`）。
11. 已在播放或等待时发 `start` → `ack`，版本不变。
12. `start` 带旧 `baseRevision` → `STALE_REVISION`，附最新 room。
13. 播放中 `changeItem autoplay:false` → 全员 `paused` 在新片的给定位置。
14. `/me` 与 `welcome` 的 `features` 都包含 `lobby`；hello 带 `["sync","lobby"]` 正常握手。
