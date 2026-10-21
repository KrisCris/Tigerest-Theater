"""客户端版本信息接口的参考实现与联调工具（配合同目录的 backend-app-release-feed.md / app-release-feed-api.md）。

依赖：Python 3.9+，pip install cryptography

  python app-release-feed-reference.py keygen <私钥保存路径>
      生成 Ed25519 密钥对。私钥以 PKCS#8 PEM 写入指定文件（不打印），屏幕上只输出要交给客户端的公钥 base64。

  python app-release-feed-reference.py self-test [--sample <输出路径>]
      读取 GitHub 当前的发布列表（设置 GITHUB_TOKEN 环境变量时带令牌），按文档规则过滤裁剪，用临时密钥签名再验签；
      检查篡改任意字节、数据过期、时间颠倒都会被拒绝，裁剪后的列表能通过比对。--sample 另存解码后的载荷，供核对。

  python app-release-feed-reference.py verify <社区服务地址> <公钥base64>
      请求已部署的接口，按客户端的同一套规则检查，并与 GitHub 的结果逐项比对（等接口刷新后再比，避开缓存期）。
"""
import base64
import datetime as dt
import json
import os
import sys
import time
import urllib.request

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

REPOSITORY = "Tigerest/Tigerest-Theater"
GITHUB_LIST = f"https://api.github.com/repos/{REPOSITORY}/releases?per_page=30"
FEED_PATH = "/api/tigerest/v1/app/releases"
RELEASE_FIELDS = ("tag_name", "draft", "prerelease", "html_url", "published_at", "body", "assets")
ASSET_FIELDS = ("name", "state", "size", "digest", "browser_download_url")
MAX_PAYLOAD = 1024 * 1024
MAX_ENVELOPE = 2 * 1024 * 1024  # 解压后的响应体；1 MiB 载荷经 base64 后约 1.34 MiB
STALE_AFTER = dt.timedelta(hours=72)
CLOCK_SKEW = dt.timedelta(minutes=10)
TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def stamp(moment: dt.datetime) -> str:
    return moment.astimezone(dt.timezone.utc).strftime(TIME_FORMAT)


def parse(text: str) -> dt.datetime:
    return dt.datetime.strptime(text, TIME_FORMAT).replace(tzinfo=dt.timezone.utc)


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def fetch_github() -> list:
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "tigerest-release-feed"}
    if os.environ.get("GITHUB_TOKEN"):
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    with urllib.request.urlopen(urllib.request.Request(GITHUB_LIST, headers=headers), timeout=30) as response:
        return json.load(response)


def filter_releases(releases: list) -> list:
    """文档「硬性规则」：去掉草稿和地址不对的 release，只保留规定字段，值原样复制，asset 不按平台筛选。"""
    kept = []
    for release in releases[:30]:
        tag = release.get("tag_name")
        if not isinstance(tag, str) or release.get("draft") is not False:
            continue
        if release.get("html_url") != f"https://github.com/{REPOSITORY}/releases/tag/{tag}":
            continue
        prefix = f"https://github.com/{REPOSITORY}/releases/download/{tag}/"
        assets = release.get("assets") or []
        if not all(str(asset.get("browser_download_url", "")).startswith(prefix) for asset in assets):
            continue
        item = {key: release.get(key) for key in RELEASE_FIELDS if key != "assets"}
        item["assets"] = [{key: asset[key] for key in ASSET_FIELDS if key in asset} for asset in assets]
        kept.append(item)
    return kept


def encode(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def build_payload(releases: list, fetched_at: str, issued_at: str) -> bytes:
    payload = {"schema": 1, "repository": REPOSITORY, "issuedAt": issued_at, "fetchedAt": fetched_at,
               "releases": filter_releases(releases)}
    raw = encode(payload)
    while len(raw) > MAX_PAYLOAD and payload["releases"]:
        payload["releases"].pop()  # 超过 1 MiB 时从最旧的删起
        raw = encode(payload)
    return raw


def envelope(private_key: Ed25519PrivateKey, key_id: str, raw: bytes) -> bytes:
    return json.dumps({"keyId": key_id, "payload": base64.b64encode(raw).decode(),
                       "signature": base64.b64encode(private_key.sign(raw)).decode()}).encode()


def open_envelope(body: bytes, public_keys: dict, at: dt.datetime = None):
    """客户端会做的检查，返回 (载荷, 载荷字节数)；任何一项不通过，客户端就退回直接请求 GitHub。"""
    if len(body) > MAX_ENVELOPE:
        raise ValueError("响应体超过 2 MiB")
    outer = json.loads(body)
    key = public_keys.get(outer.get("keyId"))
    if key is None:
        raise ValueError(f"未知 keyId：{outer.get('keyId')!r}")
    raw = base64.b64decode(outer["payload"], validate=True)
    Ed25519PublicKey.from_public_bytes(base64.b64decode(key)).verify(base64.b64decode(outer["signature"], validate=True), raw)
    if len(raw) > MAX_PAYLOAD:
        raise ValueError("载荷超过 1 MiB")
    feed = json.loads(raw)
    if feed.get("schema") != 1 or feed.get("repository") != REPOSITORY:
        raise ValueError("schema 或 repository 不对")
    issued, fetched, at = parse(feed["issuedAt"]), parse(feed["fetchedAt"]), at or now()
    if fetched > issued:
        raise ValueError("fetchedAt 晚于 issuedAt")
    if issued > at + CLOCK_SKEW:
        raise ValueError(f"issuedAt 在未来：{feed['issuedAt']}")
    if fetched < at - STALE_AFTER:
        raise ValueError(f"数据已超过 72 小时没有更新：fetchedAt {feed['fetchedAt']}")
    if not isinstance(feed.get("releases"), list) or feed["releases"] != filter_releases(feed["releases"]):
        raise ValueError("releases 含有不该出现的项或字段")
    return feed, len(raw)


def matches(served: list, served_size: int, github: list) -> bool:
    """接口列表应是 GitHub 过滤结果的前缀；比 GitHub 短时，只能是因为再加下一项就会超过 1 MiB。"""
    expected = filter_releases(github)
    count = len(served)
    if served != expected[:count]:
        return False
    # 追加下一项还要多一个逗号（列表原本为空时除外）。
    return count == len(expected) or served_size + len(encode(expected[count])) + (1 if count else 0) > MAX_PAYLOAD


def public_base64(private_key: Ed25519PrivateKey) -> str:
    raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode()


def keygen(path: str) -> None:
    if os.path.exists(path):
        sys.exit(f"{path} 已存在，不覆盖")
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as file:
        file.write(pem)
    print("私钥已写入", path)
    if os.name == "nt":
        folder = os.path.dirname(os.path.abspath(path))
        print("Windows 上 0600 不起作用，请立即按文档「私钥在 Windows 上的保管」设置 ACL，例如：")
        print(f'  icacls "{folder}" /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" "<Node 后端的服务账号>:(OI)(CI)R"')
        print(f'  icacls "{os.path.abspath(path)}"')
    print("公钥 base64：", public_base64(key))


def rejected(body: bytes, keys: dict, at: dt.datetime = None) -> bool:
    try:
        open_envelope(body, keys, at)
    except (ValueError, InvalidSignature):
        return True
    return False


def self_test(sample: str = "") -> None:
    github = fetch_github()
    key = Ed25519PrivateKey.generate()
    keys = {"self-test": public_base64(key)}
    moment = now()
    raw = build_payload(github, stamp(moment), stamp(moment))
    body = envelope(key, "self-test", raw)
    feed, size = open_envelope(body, keys)
    assert matches(feed["releases"], size, github), "完整列表应当与 GitHub 一致"
    outer = json.loads(body)
    for field in ("payload", "signature"):
        data = bytearray(base64.b64decode(outer[field]))
        data[len(data) // 2] ^= 1
        assert rejected(json.dumps({**outer, field: base64.b64encode(bytes(data)).decode()}).encode(), keys), f"篡改 {field} 后仍然通过"
    # 几个月前的数据重新签名、时间颠倒、签发时间在未来，都不能被采用。
    old = moment - dt.timedelta(days=90)
    assert rejected(envelope(key, "self-test", build_payload(github, stamp(old), stamp(moment))), keys), "陈旧数据被接受"
    assert rejected(envelope(key, "self-test", build_payload(github, stamp(moment), stamp(moment - dt.timedelta(minutes=1)))), keys), "fetchedAt 晚于 issuedAt 被接受"
    assert rejected(envelope(key, "self-test", build_payload(github, stamp(moment), stamp(moment + dt.timedelta(hours=1)))), keys), "未来的 issuedAt 被接受"
    assert not rejected(envelope(key, "self-test", build_payload(github, stamp(moment - dt.timedelta(hours=71)), stamp(moment))), keys), "71 小时内的数据应当可用"
    # 发布说明很长时服务器会裁剪，比对应当认可裁剪结果，但不认可中间缺项。
    padded = [{**release, "body": (release.get("body") or "") + "x" * 100_000} for release in github]
    trimmed, trimmed_size = open_envelope(envelope(key, "self-test", build_payload(padded, stamp(moment), stamp(moment))), keys)
    count = len(trimmed["releases"])
    assert 0 < count < len(filter_releases(padded)) and matches(trimmed["releases"], trimmed_size, padded), "裁剪结果应当通过比对"
    holed = trimmed["releases"][:1] + trimmed["releases"][2:]
    assert not matches(holed, trimmed_size, padded), "中间缺项的列表不应通过比对"
    # 边界：完整内容恰好超出 1 字节时只能留一项；恰好等于上限时两项都要留。
    def fake(tag, body=""):
        return {"tag_name": tag, "draft": False, "prerelease": False, "html_url": f"https://github.com/{REPOSITORY}/releases/tag/{tag}",
                "published_at": stamp(moment), "body": body, "assets": []}
    pair = [fake("v9.9.1"), fake("v9.9.0")]
    base = len(build_payload(pair, stamp(moment), stamp(moment)))
    for extra, kept in ((1, 1), (0, 2)):
        edge = [pair[0], fake("v9.9.0", "x" * (MAX_PAYLOAD - base + extra))]
        edge_feed, edge_size = open_envelope(envelope(key, "self-test", build_payload(edge, stamp(moment), stamp(moment))), keys)
        assert len(edge_feed["releases"]) == kept and matches(edge_feed["releases"], edge_size, edge), f"上限边界 +{extra} 字节比对出错"
    assert not matches([pair[0]], base - len(encode(pair[1])) - 1, [pair[0], fake("v9.9.0", "x" * (MAX_PAYLOAD - base))]), "放得下却被裁掉不应通过"
    # 信封超过 2 MiB 时，读取阶段就要放弃。
    assert rejected(b" " * (MAX_ENVELOPE + 1), keys), "超大信封被接受"
    tags = [release["tag_name"] for release in feed["releases"]]
    print(f"self-test 通过：{len(tags)} 个 release（GitHub 原始 {len(github)} 个），载荷 {len(raw)} 字节，最新 {tags[:3]}；"
          f"长说明裁剪到 {count} 个；1 MiB 边界、超大信封、陈旧、时间颠倒、未来签发与篡改均符合预期")
    if sample:
        with open(sample, "w", encoding="utf-8") as file:
            json.dump(feed, file, ensure_ascii=False, indent=2)
        print("解码后的示例载荷已写入", sample)


def read_feed(address: str) -> bytes:
    request = urllib.request.Request(address.rstrip("/") + FEED_PATH, headers={"User-Agent": "tigerest-release-feed-verify"})
    with urllib.request.urlopen(request, timeout=30) as response:
        # 像客户端一样边读边限：超过 2 MiB 就放弃，不先把整个响应读进内存。（urllib 不请求 gzip，读到的就是原文。）
        length = response.headers.get("Content-Length")
        if length is not None and int(length) > MAX_ENVELOPE:
            sys.exit(f"响应体声明 {length} 字节，超过 2 MiB")
        body = response.read(MAX_ENVELOPE + 1)
    if len(body) > MAX_ENVELOPE:
        sys.exit("响应体超过 2 MiB")
    return body


def verify(address: str, public_key: str) -> None:
    snapshot_at = now()
    first = fetch_github()
    deadline = time.monotonic() + 6 * 60
    while True:
        body = read_feed(address)
        keys = {json.loads(body).get("keyId"): public_key}
        feed, size = open_envelope(body, keys)
        if parse(feed["fetchedAt"]) >= snapshot_at:
            break
        if time.monotonic() > deadline:
            sys.exit(f"接口 6 分钟内没有刷新：fetchedAt 仍是 {feed['fetchedAt']}")
        print("等待接口刷新，当前 fetchedAt", feed["fetchedAt"])
        time.sleep(20)
    print("验签与新鲜度检查通过：keyId", next(iter(keys)), "issuedAt", feed["issuedAt"], "fetchedAt", feed["fetchedAt"])
    if matches(feed["releases"], size, first) or matches(feed["releases"], size, fetch_github()):
        print(f"与 GitHub 结果一致（{len(feed['releases'])} 个 release，载荷 {size} 字节）")
        return
    expected = {r["tag_name"]: r for r in filter_releases(first)}
    for release in feed["releases"]:
        if expected.get(release["tag_name"]) != release:
            print("不一致：", release["tag_name"])
    sys.exit("与 GitHub 结果不一致")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["keygen"] and len(args) == 2:
        keygen(args[1])
    elif args[:1] == ["self-test"]:
        self_test(args[2] if args[1:2] == ["--sample"] and len(args) == 3 else "")
    elif args[:1] == ["verify"] and len(args) == 3:
        verify(args[1], args[2])
    else:
        sys.exit(__doc__)
