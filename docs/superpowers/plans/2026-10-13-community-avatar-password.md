# 公共评论密码与头像增量

依据用户提供的 `X:/FRONTEND-AVATAR-PASSWORD-2026-10-13.md` 实施；用户已授权直接实现和验证，无需再次确认计划。PR #5 单独审查，等待用户确认后才可合并。

1. 会话与协议：能力驱动密码范围（新服务 8–128，旧服务 12–128）、码点计数、控制字符拒绝；登录保持兼容。二进制头像使用 Bearer，不在 URL 中携带凭据。最终 401 清除身份和受限内容。
2. 原生桥接：桌面和 Android 从当前 Emby 验证本人资料、读取本人头像，归一化 PNG 后计算 SHA-256；只有明确无图才返回 null，其他失败为未知。中央 PUT 图片接口独立体积上限，普通 JSON 上限保持不变。
3. 同步协调：每次发言检查来源，失败省略字段；未知评论结果重用 UUID 和最初头像快照。成功评论与头像上传独立。头像重试保留原字节/版本；409 仅刷新资料，429 遵循独立冷却；切换账号取消来源/上传/图片。
4. 界面：账号表单动态范围和稳定帮助文字；评论、回复预览、个人发言、消息共享中央头像加载器；上传反馈和重试入口独立于评论。登出立即清除缓存及对象 URL。
5. 验证：先协议失败测试再实现；Windows 原生桥及 WebEngine 隔离 fixture，Android JVM/构建；完整 CTest 回归。线上仅匿名能力读取，候选未部署时明确标记生产端到端待验证。
6. 审查与交付：独立审查并处理实质问题，生成新的便携测试包与验证报告。说明 PR #5 改动、CI 失败原因、Windows 验证结果和合并风险，未经确认不合并。

## 接口

- `session.passwordPolicy()`、`validatePassword(value)` 供注册、改密和 UI 共用。
- `bridge.sourceAvatar(emby, {signal})` 返回 `{hash,imageBase64}`、明确无图 `{hash:null,imageBase64:null}` 或未知 `undefined`。
- `CommunityAvatar({session,sourceAvatar})`：`prepare(attempt)` / `sent(result,attempt)` / `retry()` / `clear()` / `subscribe(listener)`；状态 `{message,retryable,busy,retryAt}`；更新事件 `{author,status}`。
- `CommunityAvatarView({client,valid,coordinator})`：`render(author)`、`update(author)`、`clear()`；只用经过认证的 Blob 和本地对象 URL。

## 重点测试

- 新旧能力、7/8 字符、emoji、空格和控制字符；旧密码登录不套用新规则。
- 来源未知与明确无图；同图免上传、变化上传；源读取取消。
- 评论响应丢失后头像变化，不生成第二条评论；上传失败不得重发评论。
- 409 不覆盖、429 不循环、不影响评论冷却；上传中切换账号禁止串图。
- 头像 GET Bearer 与错误处理、全界面显示、登出及时撤销对象 URL。

## 执行结果

六项实施/审查工作已完成，Windows 80/80 CTest 目标、Node 63/63、Android 116/116 通过；新便携包及 APK 已验证。5 个 Qt 环境限定子用例跳过，候选后端未部署，跨公网生产头像/8 位密码验收仍需部署后进行。详见 `docs/reports/2026-10-13-community-avatar-password-validation.md`。

PR #5 审查完成，存在两项已在 Windows/Chromium 复现的样式就绪问题。未合并；本计划不包含改写该 PR，按用户要求保留合并确认。审查结果见 `docs/reports/2026-10-13-pr5-review.md`。
