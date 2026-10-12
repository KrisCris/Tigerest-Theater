# 共享弹幕绑定：改为现有登录会话授权

状态：2026-10-11 用户确认的产品要求，供后端实现；下面的新授权契约尚未部署。当前 NAS v1 仍要求 `mappingWriteToken`。前端现有 v1 接入不能据此宣称普通登录用户已经能保存。

## 要解决的问题

正式发行版中的所有已登录用户，在播放器里手动选择正确弹幕后，应默认保存共享绑定，下一集以及其他客户端继续复用。用户无需申请管理员令牌、配置授权文件或导入 `credentials-mapping-client.json`。公开发行包不包含统一写入密钥。

“登录”复用现有 Emby 登录会话和评论服务的服务端身份校验。当前评论服务只接受已配置的可信 Emby；本要求覆盖该服务所有有效登录用户，不要求管理员身份。未来支持其他 Emby 时应加入可信服务配置，不能接受客户端自行声明的任意 ServerId。

## 建议后端契约

保留 `POST /api/tigerest/v1/danmaku` 的 source、selection、comment、完整弹幕响应和分段规则。自动调用没有 selection，继续允许匿名读取。只有明确的手动选集操作带 selection。

带 selection 时接受以下现有身份头，无需 `Authorization: Bearer <mappingWriteToken>`：

```http
X-Emby-Token: <当前登录响应中的 AccessToken>
X-Emby-Server-Id: <当前登录响应中的 ServerId>
X-Emby-User-Id: <当前登录响应中的 User.Id>
```

复用 `/community/v1` 的验证器，每次写入向可信 Emby 验证会话真实所有者和账号有效状态；不接受 API Key、用户名、头像、客户端管理员标记或其他用户的 Token。有效普通用户即可保存，无需开通独立的弹幕写入权限。账号失效或验证超时时不得写入。

原 `mappingWriteToken` 可保留给受信任的旧客户端作为兼容通道。若请求提供了 Emby 身份头，则按会话验证，验证失败不能悄悄降级为管理员令牌授权。服务端即使未配置 mappingWriteToken，也应允许有效会话写入。

建议新增 `GET /api/tigerest/v1/danmaku/capabilities`，匿名返回以下能力信息，避免前端把旧后端误判成支持会话写入：

```json
{"success":true,"readAuth":"anonymous","writeAuth":["emby-session","mapping-token"]}
```

只返回实际启用的 writeAuth 项。旧后端返回 404 时前端按现有 v1 处理；能力结果按网关隔离缓存，切换连接时重新检查。此接口、字段和兼容方式需随新版 CLIENT-MAPPING-API.md 一起明确，不能只在后台说明“已经支持”。

## 写入和错误行为

继续校验 selection 属于对应作品、唯一正常剧集与合法上游季度；成功返回 `match.origin=manual` 和完整 danmaku。客户端直接加载本次响应，不重复下载或单独再上报。source 始终来自原视频，edition 不包含用户或设备 ID，偏移仍由服务端按真实目录计算。

保存、调用统计和作者审计应能追溯到经过验证的服务端用户 ID；认证头和 Token 不进入调用记录、错误体、诊断日志、共享绑定内容或上游请求。共享读取响应不公开写入者私人身份。共享覆盖策略仍是当前的“最后成功保存生效”，账号级限流与后台纠错/回滚用于处理误选。

| HTTP | 后端结果 | 前端行为 |
|---|---|---|
| 200 matched=true、origin=manual | 已成功保存并返回弹幕 | 加载响应并显示所选作品/集名 |
| 401 | 会话缺失、过期、Token 无效或所有者不符 | 不写入；可加载所选旧 GET 弹幕，说明未保存并提示重新登录 |
| 403 | Emby 不在可信配置或账号被限制写入 | 不写入；允许加载旧弹幕，说明共享绑定未保存 |
| 429 + Retry-After | 用户或网关额度限制 | 不写入；遵守等待时间，不立即向同网关发旧 GET 或搜索 |
| 503 | 身份验证服务不可用或写入服务关闭 | 不写入；允许旧接口回退，说明未保存 |

400/413/415/422、无映射和上游失败继续沿用当前文档。错误体保留 `{success:false,errorMessage:...}`，建议增加稳定的可选 `errorCode`（AUTH_REQUIRED、AUTH_INVALID、SERVER_NOT_ALLOWED、WRITE_FORBIDDEN、AUTH_UNAVAILABLE），前端不依赖中文字符串判断身份错误。浏览器 CORS 预检需要允许三个现有 Emby 身份头；Token 不放在 URL。

## 后端验收

1. 未配置 mappingWriteToken，合法普通 Emby 用户仍能手动保存；第 3 集校准后，第 4 集匿名读取命中，并且另一个客户端可复用。
2. 缺失、过期、伪造或不属于当前 UserId 的 Token，以及未受信任的 ServerId，均不能创建或覆盖绑定；API Key 不能代替用户会话。
3. 自动查询、自动匹配和历史命中不会写回。错误选择、不存在集、跨季度、重复编号和上游失败没有成功校准记录。
4. 第 8 集再次选择产生新分段，前面的分段保留；账号变化不污染 source/edition，ID 不做算术递增。
5. 429 返回可用 Retry-After；后台能看到成功用户和拒绝原因，所有日志均不含凭据。匿名读取和旧受信任客户端兼容。

## 前端后续接线

后端发布明确的新契约及可联调部署后，Windows/macOS 和 Android 在用户手动选集时从当前登录会话发送身份，取消普通用户的令牌配置步骤。桌面 Lua 不能把会话 Token 写进命令参数、MPV 公共属性或共享设置：由原生层负责会话请求或生成当前账号隔离的私有头文件，Lua 仅拿文件路径。退出、切换账号或连接时中止旧请求并清理临时授权；响应到达时仍检查原播放项和账号会话。

验收必须覆盖正式包中无授权 JSON/私有头文件的新配置、普通用户登录后保存、登出及切换账号时过期响应被丢弃、其他客户端下一集复用。现有管理员 JSON 只可用于当前 v1 的独立真实联调，不能作为上述新授权验收的替代。

参考：[现有评论身份协议](community-api.md)、[当前共享弹幕 v1](danmaku-mapping-api.md)。
