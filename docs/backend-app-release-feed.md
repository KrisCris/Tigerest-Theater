# 客户端版本信息：由社区服务器提供

状态：2026-10-21 用户确认由社区服务器接管客户端的版本检查。后端两轮评审后确认可作为实施依据（接入现有 Node 后端）。本版已按评审意见补齐：304、数据陈旧上限、Windows 私钥权限、验收比对、iPad 说明、响应体大小上限和查询参数表述。接口尚未部署（线上返回 404），客户端尚未接线。

## 要解决的问题

Windows、Mac、Android 和 iPad 现在都匿名请求 `https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30` 来判断有没有新版本。匿名额度是每个 IP 每小时 60 次，宿舍、公司和运营商共享出口很容易用完，客户端随后只能显示「GitHub 请求受限」。部分网络还连不上 api.github.com。

安装包本身仍然只放在 GitHub Release。客户端经 gh-proxy.com、ghproxy.net 加速下载，最后回到 GitHub 原址（2.9.4 起）。社区服务器只接管「版本信息」这一步：用自己的 GitHub 令牌定时读取发布列表，加上签名，再提供给所有客户端。

## 接口

```http
GET <社区服务地址>/api/tigerest/v1/app/releases
```

- 匿名访问，不带 Emby 身份头。版本检查发生在登录之前，连接 Jellyfin 或其他服务器的用户也要用。
- `<社区服务地址>` 就是客户端现在访问弹幕和评论用的那个地址，主机和端口都相同。不重定向，不需要 CORS（只有原生客户端访问）。
- 只需支持 `GET`。接口不使用查询参数，传入时忽略。
- 响应头 `Content-Type: application/json; charset=utf-8`。可以 gzip，签名针对的是解压后的内容。
- 解压后的响应体（整个信封）不超过 2 MiB。载荷上限 1 MiB，经 base64 后约 1.34 MiB，留有余量。客户端边读边计数，超过 2 MiB 立即中止，不会先读完再检查。
- **首版不用 ETag 和 304**：每次都返回 200 和完整信封（目前约 250 KB，gzip 后小得多）。客户端不会发 `If-None-Match`，收到 304 一律按失败处理，转去请求 GitHub。
- 单 IP 建议限流在每分钟 30 次，超出返回 429 并带 `Retry-After`。客户端每次启动最多请求一次。

### 成功响应（200）

响应体是一个签名信封：

```json
{
  "keyId": "tg-release-1",
  "payload": "<base64(载荷 JSON 的 UTF-8 字节)>",
  "signature": "<base64(Ed25519 对上面那串解码后字节的签名)>"
}
```

载荷用 base64 原样装进信封，签名对象就是这串字节，不存在 JSON 规范化的问题。

解码后的载荷：

```json
{
  "schema": 1,
  "repository": "Tigerest/Tigerest-Theater",
  "issuedAt": "2026-10-21T08:00:00Z",
  "fetchedAt": "2026-10-21T07:58:12Z",
  "releases": [
    {
      "tag_name": "v2.9.3",
      "draft": false,
      "prerelease": false,
      "html_url": "https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.9.3",
      "published_at": "2026-10-21T03:12:40Z",
      "body": "发布说明原文……\n<!-- tigerest-mirrors {\"quark\":\"https://pan.quark.cn/s/…\",\"baidu\":\"https://pan.baidu.com/s/…\"} -->",
      "assets": [
        {
          "name": "TigerestTheater-2.9.3-x64.exe",
          "state": "uploaded",
          "size": 246076495,
          "digest": "sha256:<64 位十六进制>",
          "browser_download_url": "https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.9.3/TigerestTheater-2.9.3-x64.exe"
        }
      ]
    }
  ]
}
```

| 字段 | 要求 |
|---|---|
| `schema` | 固定为 `1`。不兼容的改动换新数字，客户端遇到不认识的数字会回退到 GitHub。 |
| `repository` | 固定为 `Tigerest/Tigerest-Theater`。 |
| `issuedAt` | 本次签名的时间（UTC，精确到秒，格式同示例）。每次刷新缓存都重新签名，即使内容没变。 |
| `fetchedAt` | 最近一次成功从 GitHub 读到列表的时间（同样格式）。GitHub 不可用期间保持旧值，永远不晚于 `issuedAt`。 |
| `releases` | GitHub 返回的数组，按原顺序（最新在前），最多 30 项。每个 release 只保留示例中的 7 个字段，每个 asset 只保留示例中的 5 个字段。值逐字复制 GitHub 的原始值，不改写，不补算。 |

几条硬性规则：

- `digest` 只能来自 GitHub API 返回的原值。不能由服务器自己计算，也不能在后台手工填写或修改。缺少 `digest` 的 asset 照样原样传，客户端会跳过它。
- `body` 不做任何修改，结尾的 `<!-- tigerest-mirrors … -->` 标记就是更新窗口里「备用下载」用的网盘链接。
- 草稿（`draft: true`）一律不输出。用一个没有仓库写权限的令牌，GitHub 本身就不会返回草稿；即便如此，输出前仍要按 `draft` 过滤一次。
- 只输出满足下面两条的 release，不满足的整项丢掉：
  - `html_url` 等于 `https://github.com/Tigerest/Tigerest-Theater/releases/tag/<tag_name>`
  - 每个 asset 的 `browser_download_url` 都以 `https://github.com/Tigerest/Tigerest-Theater/releases/download/<tag_name>/` 开头
- 所有 asset 照原样传，不按平台筛选。iPad 用的 `-ipad.ipa`、`SHA256SUMS` 等也保留。
- 解码后的载荷不超过 1 MiB，超出时从最旧的 release 开始删。

### 数据新鲜度

签名只能证明信息出自我们的服务器，不能证明信息还新。所以除了 `issuedAt`，客户端还会检查 `fetchedAt`，服务器也要设上限：

- **服务器**：距 `fetchedAt` 超过 72 小时（即 GitHub 连续 72 小时都没读成功），就停止提供旧列表，改为返回 503 `RELEASES_STALE`。这个上限建议做成配置项，方便验收时临时调短。
- **客户端**：下面三条都满足才采用，否则转去请求 GitHub：
  - `fetchedAt` ≤ `issuedAt`；
  - `issuedAt` 不晚于客户端当前时间 10 分钟以上；
  - `fetchedAt` 不早于客户端当前时间 72 小时以上。

  客户端缓存的信封下次启动时也按同样三条检查，过期的不再先行显示。

这样，几个月前的数据即使被重新签名，也不会被客户端采用。设备时钟偏差超过 72 小时的客户端会一直回退到 GitHub，行为和现在一样。

### 失败响应

不签名，格式与 `/api/tigerest/v1/danmaku` 一致：

| HTTP | `errorCode` | 何时返回 |
|---|---|---|
| 503 | `RELEASES_UNAVAILABLE` | 服务启动后还没成功读到过 GitHub，或功能被关闭 |
| 503 | `RELEASES_STALE` | 距 `fetchedAt` 已超过 72 小时 |
| 429 | `RATE_LIMITED` | 超过单 IP 限流，带 `Retry-After` |

```json
{"success":false,"errorCode":"RELEASES_STALE","errorMessage":"版本信息已过期"}
```

客户端遇到任何非 200（包括 304）、响应体超过 2 MiB、验签失败、`schema` 或 `repository` 不对、或者不满足上面的新鲜度要求，都会改为直接请求 GitHub API（也就是现在的做法），不会报错给用户。

## 为什么要签名

社区服务地址用的是 HTTP，不是 HTTPS。没有签名的话，同一网络里的任何人都可以改写响应，比如：

- 把网盘链接换成自己的分享，诱导用户下载被篡改的安装包；
- 改掉 SHA-256，让加速镜像送来的错误文件通过校验；
- 在发布说明里写钓鱼文字。

客户端只会从 `github.com/Tigerest/Tigerest-Theater/releases/download/…` 及其加速镜像下载，这一点不受信息来源影响。但 SHA-256 和网盘链接以后会以这份信息为准，所以必须能确认它出自我们的服务器。

### 密钥

- 后端生成一对 Ed25519 密钥，可以用随附脚本的 `keygen`，也可以用 Node 的 `crypto.generateKeyPairSync('ed25519')`。私钥用 PKCS#8 PEM 保存。
- 公钥（32 字节原始公钥的 base64）和 `keyId` 交给客户端开发，客户端会内置到程序里。私钥不发给任何人。
- 换钥时用新的 `keyId`。过渡期客户端同时内置新旧两把公钥，等大部分用户升级后服务器再改用新钥。私钥泄露时立刻换钥，并发布一个只认新钥的客户端。

### 私钥在 Windows 上的保管

NAS 跑的是 Windows，POSIX 的 `0600` 在这里不起作用（Python 和 Node 在 Windows 上都只能设置只读标志），必须用 NTFS ACL 限制：

1. 私钥放在服务专用目录，例如 `C:\ProgramData\TigerestCommunity\keys\release-signing.pem`。不能放在任何共享文件夹、同步盘或备份源目录下（包括交接用的「网络交流」文件夹）。
2. 去掉继承，只留三类账户：

   ```bat
   icacls "C:\ProgramData\TigerestCommunity\keys" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "<Node 后端的服务账号>:(OI)(CI)R"
   icacls "C:\ProgramData\TigerestCommunity\keys\release-signing.pem"
   ```

   第二条的输出里只能出现这三个账户。如果 Node 后端以 LocalSystem 运行，第三项可以省略。
3. 用一个普通用户账户（不在 Administrators 组）尝试读取，例如 `type` 这个文件，应当提示拒绝访问。
4. 核对 NAS 的备份和同步任务：源路径不包含这个目录。做一次备份后，在备份内容里搜索 `release-signing.pem`，确认没有。

### Node 签名示例

```js
const crypto = require('node:crypto');
const fs = require('node:fs');

const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));   // PKCS#8 PEM

function envelope(keyId, payload) {
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  return JSON.stringify({
    keyId,
    payload: raw.toString('base64'),
    signature: crypto.sign(null, raw, privateKey).toString('base64'),   // Ed25519 的算法参数传 null
  });
}

// 交给客户端的公钥：32 字节原始公钥的标准 base64（不是 base64url）
const jwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
const publicKeyBase64 = Buffer.from(jwk.x, 'base64url').toString('base64');
```

## 服务器如何读取 GitHub

- 请求 `GET https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30`，带上 `Accept: application/vnd.github+json` 和 `X-GitHub-Api-Version: 2022-11-28`。
- 用一个 fine-grained 令牌：只选这个公开仓库，不勾任何写权限。用它只是为了把额度提到每小时 5000 次。令牌只出现在请求头里，不进日志、错误信息、响应或备份。
- 每 5 分钟读一次，带上次的 `ETag`（`If-None-Match`）。GitHub 返回 304 不消耗额度，此时算作读取成功：更新 `fetchedAt`，并重新签名。这里的 ETag 只用在服务器和 GitHub 之间，与客户端无关。
- 可选：配置 GitHub 的 `release` webhook（验证 `X-Hub-Signature-256`），收到发布或编辑事件后立刻刷新。没有 webhook 时，新版本最多延迟 5 分钟出现。
- GitHub 读失败、超时或令牌失效时，72 小时内继续提供上一次成功的列表（`fetchedAt` 不变，照常重新签名），并在后台告警；超过 72 小时按上文返回 503 `RELEASES_STALE`。上一次成功的列表和它的 `fetchedAt` 要落盘，服务重启后照样能用。
- GitHub 返回的数据先按上面的规则过滤、裁剪，再签名缓存。不要在请求到来时现场访问 GitHub。

## 客户端会怎么用（供参考，前端负责）

1. 启动检查时先请求本接口，验签并通过上述检查后，用 `releases` 按现有规则挑出本平台的新版本。现有规则包括：
   - 只认正式版；
   - asset 名称固定为 `TigerestTheater-<版本>-x64.exe`、`-x64.zip`、`-arm64.dmg` 或 `-android.apk`；
   - `browser_download_url` 必须是 GitHub 原址。
2. 本接口不可用或不可信时，退回直接请求 GitHub API，行为和现在一样。
3. Windows、Mac 和 Android 下载仍然走 gh-proxy.com → ghproxy.net → GitHub 原址，按载荷里的 `size` 和 `digest` 核验。Android 另外核对 APK 签名证书必须与已安装版本一致。
4. 网盘链接取自 `body` 里的 `tigerest-mirrors` 标记，没有标记时用内置分享。
5. **iPad 只提示，不下载。** iPad 目前是开发签名版，只能在 Mac 上用 Xcode 构建安装，没有其他分发渠道。
   - iPad 在列表里找 `TigerestTheater-<版本>-ipad.ipa`：找到更新的版本时，提示用户在 Mac 上更新源码并用 Xcode 重新构建安装；没有时显示项目最新正式版的发布说明，并注明不代表已发布 iPad 包。
   - 服务器不需要为 iPad 做任何特殊处理，asset 照原样传即可。

## 后端验收

1. 用随附脚本的 `verify <社区服务地址> <公钥>` 检查通过：验签、新鲜度，以及与 GitHub 的逐项比对（包括 `digest` 和 `body` 原文）。
   - 脚本先读一次 GitHub 作为快照，等接口的 `fetchedAt` 晚于快照时间（最多 6 分钟）再比较，避开 5 分钟缓存期。
   - 比较时对 GitHub 数据套用同样的过滤和 1 MiB 裁剪。如果比较期间 GitHub 又有变化，再读一次 GitHub，与任意一次快照一致即算通过。
2. 在 GitHub 上发布新版本或修改发布说明里的网盘标记，5 分钟内（有 webhook 则立刻）出现在本接口里；草稿始终不出现。
3. 篡改载荷或签名中的任意一个字节，验签都失败（`self-test` 已覆盖）。
4. 断开 GitHub（或吊销令牌）：接口继续返回上一份列表，`issuedAt` 照常更新，`fetchedAt` 停在断开前，重启服务后仍然如此。把陈旧上限临时调短，超过后接口返回 503 `RELEASES_STALE`。
5. 全新部署、尚未读到过 GitHub 时返回 503 `RELEASES_UNAVAILABLE`。
6. 超过限流返回 429 和 `Retry-After`；客户端带 `If-None-Match` 请求时仍返回 200 和完整信封。
7. 私钥按上文「私钥在 Windows 上的保管」完成 ACL 和备份排除的检查；日志、响应和错误信息里都没有 GitHub 令牌和私钥。
8. 交付给客户端：生产公钥（base64）、`keyId`、部署好的地址，以及一份当时抓取的真实响应，供客户端做离线测试。

## 随附文件

- `app-release-feed-reference.py`：参考实现兼联调工具，与本文放在同一目录（需要 `pip install cryptography`）。
  - `keygen <私钥路径>`：生成密钥对。私钥只写进文件，屏幕上只显示要交给客户端的公钥，并提示如何设置 Windows ACL。
  - `self-test`：读取 GitHub 当前列表，按本文规则过滤、裁剪、签名、验签。同时检查：篡改任何一个字节都会验签失败；1 MiB 边界（恰好等于上限、超出 1 字节）的裁剪和比对正确；超过 2 MiB 的信封会被拒绝。设置 `GITHUB_TOKEN` 环境变量可以避开匿名限额。
  - `verify <社区服务地址> <公钥>`：部署后检查接口，对应验收第 1 条。
  - 脚本里的 `build_payload` 和 `open_envelope` 就是本文过滤裁剪规则和客户端检查的代码版本。两者不一致时以本文为准，并告诉客户端开发。
- `app-release-feed-sample-payload.json`（只在交接文件夹里）：用脚本从 GitHub 实际生成的解码后载荷，可以用来对照字段和格式。
