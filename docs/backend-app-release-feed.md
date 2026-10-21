# 客户端版本信息：由社区服务器提供

状态：2026-10-21 用户确认由社区服务器接管客户端的版本检查，供后端实现；下面的接口尚未部署，客户端尚未接线。

## 要解决的问题

Windows、Mac、Android 和 iPad 现在都匿名请求 `https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30` 来判断有没有新版本。匿名额度是每个 IP 每小时 60 次，宿舍、公司和运营商共享出口很容易用完，客户端随后只能显示「GitHub 请求受限」。部分网络还连不上 api.github.com。

安装包本身仍然只放在 GitHub Release。客户端经 gh-proxy.com、ghproxy.net 加速下载，最后回到 GitHub 原址（2.9.4 起）。社区服务器只接管「版本信息」这一步：用自己的 GitHub 令牌定时读取发布列表，加上签名，再提供给所有客户端。

## 接口

```http
GET http://nas.tigerest.top:18443/api/tigerest/v1/app/releases
```

- 匿名访问，不带 Emby 身份头。版本检查发生在登录之前，连接 Jellyfin 或其他服务器的用户也要用。
- 与弹幕、评论共用 18443 端口和同一主机名。不重定向，不需要 CORS（只有原生客户端访问）。
- 支持 `GET` 和 `HEAD`，不接受查询参数，忽略多余的参数。
- 响应头 `Content-Type: application/json; charset=utf-8`。可以 gzip，签名针对的是解压后的内容。
- 建议加上 `ETag`，命中 `If-None-Match` 时返回 304。
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

载荷用 base64 原样装进信封，签名对象就是这串字节，不存在 JSON 规范化的问题。客户端会把整个信封原样缓存，下次启动时重新验签后再显示。

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
| `issuedAt` | 本次签名的时间（UTC）。每次刷新缓存都重新签名，即使内容没变。 |
| `fetchedAt` | 最近一次成功从 GitHub 读到列表的时间。GitHub 不可用期间保持旧值。 |
| `releases` | GitHub 返回的数组，按原顺序（最新在前），最多 30 项。每个 release 只保留上表示例中的 7 个字段，每个 asset 只保留示例中的 5 个字段。值逐字复制 GitHub 的原始值，不改写，不补算。 |

几条硬性规则：

- `digest` 只能来自 GitHub API 返回的原值。不能由服务器自己计算，也不能在后台手工填写或修改。缺少 `digest` 的 asset 照样原样传，客户端会跳过它。
- `body` 不做任何修改，结尾的 `<!-- tigerest-mirrors … -->` 标记就是更新窗口里「备用下载」用的网盘链接。
- 草稿（`draft: true`）一律不输出。用一个没有仓库写权限的令牌，GitHub 本身就不会返回草稿；即便如此，输出前仍要按 `draft` 过滤一次。
- 只输出满足下面两条的 release，不满足的整项丢掉：
  - `html_url` 等于 `https://github.com/Tigerest/Tigerest-Theater/releases/tag/<tag_name>`
  - 每个 asset 的 `browser_download_url` 都以 `https://github.com/Tigerest/Tigerest-Theater/releases/download/<tag_name>/` 开头
- 解码后的载荷不超过 1 MiB，超出时从最旧的 release 开始删。

### 失败响应

服务器启动后还没成功读到过 GitHub，或者功能被关闭时，返回不签名的 503：

```json
{"success":false,"errorCode":"RELEASES_UNAVAILABLE","errorMessage":"版本信息暂不可用"}
```

格式与 `/api/tigerest/v1/danmaku` 一致。客户端遇到任何非 200、验签失败、`schema` 或 `repository` 不对、`issuedAt` 早于 7 天前或晚于当前时间 10 分钟以上，都会改为直接请求 GitHub API（也就是现在的做法），不会报错给用户。

## 为什么要签名

18443 端口是 HTTP。没有签名的话，同一网络里的任何人都可以改写响应，比如：

- 把网盘链接换成自己的分享，诱导用户下载被篡改的安装包；
- 改掉 SHA-256，让加速镜像送来的错误文件通过校验；
- 在发布说明里写钓鱼文字。

客户端只会从 `github.com/Tigerest/Tigerest-Theater/releases/download/…` 及其加速镜像下载，这一点不受信息来源影响。但 SHA-256 和网盘链接以后会以这份信息为准，所以必须能确认它出自我们的服务器。

### 密钥

- 后端用 Ed25519 生成一对密钥：
  - 私钥只存在社区服务器上，放在仓库和日志之外，文件权限 600，不进 NAS 共享备份，不发给任何人；
  - 公钥（32 字节原始公钥的 base64）和 `keyId` 发给客户端开发，客户端会把它内置到程序里。
- 换钥时用新的 `keyId`。过渡期客户端同时内置新旧两把公钥，等大部分用户升级后服务器再改用新钥。私钥泄露时立刻换钥，并发布一个只认新钥的客户端。

参考实现（Python，`cryptography` 包）：

```python
import base64, json
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

def envelope(private_key: Ed25519PrivateKey, key_id: str, payload: dict) -> bytes:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return json.dumps({
        "keyId": key_id,
        "payload": base64.b64encode(raw).decode(),
        "signature": base64.b64encode(private_key.sign(raw)).decode(),
    }).encode()
```

联调用的验签脚本：

```python
import base64, json, urllib.request
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

PUBLIC_KEY = "<后端给出的公钥 base64>"
env = json.load(urllib.request.urlopen("http://nas.tigerest.top:18443/api/tigerest/v1/app/releases"))
raw = base64.b64decode(env["payload"])
Ed25519PublicKey.from_public_bytes(base64.b64decode(PUBLIC_KEY)).verify(base64.b64decode(env["signature"]), raw)
feed = json.loads(raw)
print(env["keyId"], feed["issuedAt"], [r["tag_name"] for r in feed["releases"]][:3])
```

## 服务器如何读取 GitHub

- 请求 `GET https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30`，带上 `Accept: application/vnd.github+json` 和 `X-GitHub-Api-Version: 2022-11-28`。
- 用一个 fine-grained 令牌：只选这个公开仓库，不勾任何写权限。用它只是为了把额度提到每小时 5000 次。令牌只出现在请求头里，不进日志、错误信息、响应或备份。
- 每 5 分钟读一次，带上次的 `ETag`（`If-None-Match`）。GitHub 返回 304 不消耗额度，此时只重新签名。
- 可选：配置 GitHub 的 `release` webhook（验证 `X-Hub-Signature-256`），收到发布或编辑事件后立刻刷新。没有 webhook 时，新版本最多延迟 5 分钟出现。
- GitHub 读失败、超时或令牌失效时，继续提供上一次成功的列表（`fetchedAt` 不变，照常重新签名），并在后台告警。上一次成功的列表要落盘，服务重启后照样能用。
- GitHub 返回的数据先按上面的规则过滤，再签名缓存。不要在请求到来时现场访问 GitHub。

## 客户端会怎么用（供参考，前端负责）

1. 启动检查时先请求本接口，验签并通过上述检查后，用 `releases` 按现有规则挑出本平台的新版本。现有规则包括：
   - 只认正式版；
   - asset 名称固定为 `TigerestTheater-<版本>-x64.exe`、`-x64.zip`、`-arm64.dmg` 或 `-android.apk`；
   - `browser_download_url` 必须是 GitHub 原址。
2. 本接口不可用或不可信时，退回直接请求 GitHub API，行为和现在一样。
3. 下载仍然走 gh-proxy.com → ghproxy.net → GitHub 原址，按载荷里的 `size` 和 `digest` 核验。Android 另外核对 APK 签名证书必须与已安装版本一致。
4. 网盘链接取自 `body` 里的 `tigerest-mirrors` 标记，没有标记时用内置分享。

## 后端验收

1. 用上面的验签脚本拿生产公钥验证通过，`releases` 与 GitHub API 同一时刻的结果逐项一致，包括 `digest` 和 `body` 原文。
2. 在 GitHub 上发布新版本或修改发布说明里的网盘标记，5 分钟内（有 webhook 则立刻）出现在本接口里；草稿始终不出现。
3. 篡改载荷或签名中的任意一个字节，验签都失败。
4. 断开 GitHub（或吊销令牌），接口继续返回上一份列表，`issuedAt` 照常更新，`fetchedAt` 停在断开前；重启服务后仍然如此。
5. 全新部署、尚未读到过 GitHub 时返回 503 和 `RELEASES_UNAVAILABLE`。
6. 超过限流返回 429 和 `Retry-After`；日志、响应和错误信息里都没有 GitHub 令牌和私钥。
7. 交付给客户端：生产公钥（base64）、`keyId`、部署好的地址，以及一份当时抓取的真实响应，供客户端做离线测试。

参考：[弹幕接口](danmaku-mapping-api.md)的错误格式、[评论服务端 API](community-api.md)的主机与端口约定。
