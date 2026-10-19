# Remembered servers and client menu: shared contract

Shared by Windows/Linux (Qt), Android and the Apple clients. The reference
implementation is `native/serverHistory.js`; its behaviour is pinned by
`tests/test_server_history.js`. Apple implements the same data rules natively
and must read and write the same setting value without loss.

## Storage

- Per client profile, setting `main.knownServers` (hidden, default `""`).
- Value: a JSON string, at most 32768 characters:

```json
{"version":1,"servers":[
  {"mode":"custom","address":"https://media.example/jellyfin/","name":"Living room","kind":"jellyfin","serverId":"0f3c…","lastConnectedAt":1760870400000},
  {"mode":"tigerest","address":"http://10.0.0.2:8096/","name":"大河专属 EMBY","kind":"emby","lastConnectedAt":1760784000000}
]}
```

| Field | Rule |
| --- | --- |
| `version` | Must be `1`. Any other value, invalid JSON or a missing `servers` array reads as an empty list (never an error). |
| `servers` | At most 20 records, newest `lastConnectedAt` first. Extra records are dropped on read and write. |
| `mode` | `custom` or `tigerest`. Other records are skipped. |
| `address` | Canonical address (below). Records whose address does not canonicalize are skipped. |
| `name` | Optional display text from the server (`ServerName`). Control and bidi-override characters removed, trimmed, at most 80 characters. Always rendered as text, never HTML. |
| `kind` | Optional, `emby` or `jellyfin`. |
| `serverId` | Optional, `[A-Za-z0-9-]{1,64}`. Never stored for `tigerest`. Display/diagnostics only: it is **not** used to merge records. |
| `lastConnectedAt` | Milliseconds since epoch of the last successful load; `0` = migrated, date unknown. |

No credentials, tokens, user names or user ids are ever stored here. Each
server's login stays in that origin's own web storage (and the existing
per-server session stores), so removing a record does not sign the user out
or delete anything on the server.

### Canonical address and record key

Parse as a URL. Reject anything that is not `http`/`https`, has no host, or
embeds a user name or password. Otherwise build
`scheme://host[:port]/path/`, where:

- scheme and host are lower-cased (IPv6 kept in brackets) and the default port
  (`80`/`443`) is dropped. Any other port is kept.
- the base path is kept. Only a trailing `/web`, `/web/` or
  `/web/index.html` (case-insensitive) is removed. Query and fragment are
  dropped. The result always ends in `/`.

Record key (computed, not stored): `tigerest` for the dedicated server, which
is one logical record for both its LAN and public address; otherwise
`custom:<canonical address>`. Duplicate keys keep the first (newest) record.

Vectors (identical in every client):

| Input | Canonical |
| --- | --- |
| `HTTP://Media.Example:80/` | `http://media.example/` |
| `https://media.example:443/jellyfin/web/index.html?x=1#/home` | `https://media.example/jellyfin/` |
| `http://[FE80::2]:8096/web` | `http://[fe80::2]:8096/` |
| `http://192.168.1.5:8096` | `http://192.168.1.5:8096/` |
| `https://a.example/emby/web/` | `https://a.example/emby/` |
| `https://a.example/Web/Index.html` | `https://a.example/` |
| `http://u:p@a.example/` | rejected |
| `ftp://a.example/` | rejected |

### Operations

- **remember(mode, address, at, replacing?)**: after a successful connection, put the
  record first with the new `lastConnectedAt`, and keep any name/kind/serverId
  already known for the same key. With `replacing` ("edit address"), the old key
  is removed in the same write.
- **annotate(mode, address, name, kind, serverId)**: run by the loaded server page.
  It only updates an existing record and **never creates one**.
- **forget(key)**: an explicit user removal, after confirmation. The record of
  the currently connected server is not offered for removal.
- **list(current, mode)**: if the current `userWebClient` has no record (an install
  from before this feature), show it once with `lastConnectedAt: 0`. Only that
  existing address migrates; earlier servers are never invented.

## Selection transaction (bridge)

The chooser (`find-webclient.html`) computes the new history text but does not
write it. The native side commits it only when the server page has loaded:

```
system.finishServerSelection(server, mode, target, history) -> bool
```

- `server`: the canonical address, saved as `main.userWebClient`.
- `mode`: `custom` or `tigerest`, saved as `main.serverConnectionMode`.
- `target`: the verified web client URL to navigate to.
- `history`: the result of `remember(…)`, or `""` to leave history untouched.
  It is rejected (returns `false`, nothing changes) if it is over 32768
  characters, is not a JSON object, or has no `servers` array of at most 20 items.

Commit semantics are unchanged from 4db34c7, with history added:

1. Save the pending selection and navigate to `target`.
2. Page load succeeds (Qt `LoadSucceeded` in `webview.qml`, Android
   `WebHost.onPageFinished`): write `userWebClient`, `serverConnectionMode`
   and then `knownServers` (when `history` is non-empty).
3. Load fails or the user cancels: roll back (`tigerestServerSelectionFailed`).
   Neither the previous address nor its history changes.

Startup still opens the last successful server (`userWebClient`). The list is
shown only when the user opens the chooser.

The loaded page reads `knownServers` from settings and, about 1.5 seconds
after `load`, annotates the record whose canonical address equals the page's
server base and the saved `userWebClient`.

## Client entries (shared web layer)

- The header has one client menu button, `#tigerest-mpv-settings-button`
  (text "客户端", `aria-haspopup=menu`). Its menu `#tigerest-client-menu`
  shows the current server, then "切换 / 管理服务器", "播放器设置（MPV）",
  "客户端设置" and "下载与离线媒体" (the last one is not shown on Android).
  The window-mode and update buttons stay separate, because they show state or a badge.
- On Jellyfin's Modern layout the button mounts beside the visible
  `[aria-controls="app-user-menu"]` button, not in the hidden legacy header.
- The home heading shows a current-server chip `.tigerest-home-server`.
  Logged-out standalone pages show `.tigerest-switch-entry`.
- Each server's own server-list entry is redirected to
  `window.tigerestSwitchServer()`. These are `.btnSelectServer`,
  `a[href*="selectserver"]`, `[data-id="selectserver"]` and the Modern
  user-menu item with `svg[data-testid="StorageIcon"]`. Sign-out, add-server and
  expired-login flows are not intercepted.
- `window.tigerestSwitchServer()` uses `api.system.openServerSettings()` when the
  host provides it (Apple), otherwise `find-webclient.html?choose=1`.
- Back handlers return `true` when they consumed Back:
  `tigerestServerSelectionBack()` (chooser: cancels a pending connection) and
  `tigerestClientMenuBack()` (closes the menu). Android's order is
  chooser, client menu, home motion, then history/finish.

## Apple (Mac/iPad/TV) to-do

The Apple client is not changed by this round. Needed for parity:

1. Add `serverHistory` (before `nativeshell`) to `SCRIPTS` in
   `apple/tools/sync_resources.py`, so the shared page has
   `TigerestServerHistory` (used by the menu label and the annotation).
2. Add `knownServers` to the `main` keys in `apple/App/SettingsStore.swift`. Apply the
   same validation: a string of at most 32768 characters that is a JSON object
   with `servers` holding at most 20 items. Keep it per profile like the other settings.
3. Expose `knownServers` through the existing `settings.value`/`setValue`
   bridge, so the page's annotation can read and write it.
4. Port the canonical-address, key, remember, forget and list rules to Swift.
   Test them with the vector table above plus the cases in
   `tests/test_server_history.js` (dedicated record is one entry,
   aliases with the same `serverId` are kept apart, no credentials, invalid JSON
   is empty, limit 20, migration only of the current address).
5. In `AppModel.saveConnection`, write the remembered history only after the web
   view reports a successful load of the new server. Do not write it in the same
   step as `userWebClient`. Leave the previous value on failure or cancel.
6. Extend the SwiftUI connection sheet (`openServerSettings`) with the list:
   - Newest first. Each card shows the name or host, the kind and address, and
     a "当前" mark.
   - Per-card actions: connect, retry with the error on that card, edit address,
     and remove with confirmation (not for the current server).
   - Adding a server stays a separate explicit action.
7. `openServerSettings` remains the switch target. The four-argument
   `finishServerSelection` is needed only if Apple adopts `find-webclient.html`.
