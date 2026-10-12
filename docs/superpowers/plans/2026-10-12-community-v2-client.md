# Community v2 client implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 大河登录即用共享弹幕和公共评论，外服独立评论登录，保留私人反馈，修复音量记忆。

**Architecture:** 共享 JavaScript 管理公共会话、媒体身份和评论界面；原生层限定社区目的地、保存加密凭据并提供映射会话授权。保留 v1 私人客户端，公共 v2 复用现有呈现与分页。

**Tech Stack:** Qt 6/C++、JavaScript、Kotlin/OkHttp、Windows Credential Manager、macOS Keychain、Android Keystore。

**Spec:** ../specs/2026-10-12-community-v2-and-mapping-session-design.md

## Global constraints
- 公共服务固定 http://nas.tigerest.top:18443/community/v2；禁止重定向。
- 外服 Emby token 不离开其服务器；可信 GUID 来自 capabilities，比较忽略连字符和大小写。
- 刷新单飞、旋转先保存再放行业务，丢失响应不得重复旧 refresh。
- 不发送生产测试评论，不污染安装版设置。原生测试每次同 PowerShell 加载 Enter-TestEnvironment.ps1。
- 用户已批准直接实现与验证，无需再次确认计划。音量独立任务已完成定向验证。

## Review focus
- 同账号刷新 token 或快速切换账号：旧响应、凭据和弹幕写权限不能留给新上下文。
- 安全存储失败与刷新响应丢失：不回退明文、不重复旋转旧 token。
- 季0、同剧多版本、未知集序：不猜错媒体或跨服 Item.Id。
- 后端503及能力故障：保留已有登录，不误显示注册或不断重试。
- 公共/私人切换、消息跳转、已删除对象：不串草稿、重复未读或静默错误跳转。

### Task 1: Shared public protocol and session state
**Files:** Create native/communitySession.js, native/communityPublicClient.js, tests/test_community_v2.js.
**Interfaces:** `TigerestCommunitySession({transport, store, now})`, `setSession(emby)`, `discover()`, `ready()`, `login/register/logout/changePassword`, `request(path, options)`; `TigerestCommunityPublicClient(session)` inherits common comment operations and overrides request/resolve/messages. `mediaIdentity(item, series, scope)` returns canonical body or throws.
- [x] Add failing node tests for trusted GUID, external token isolation, refresh singleflight/lost response, cancellation, media identities, no v1 type filter, anchors and retry UUID.
- [x] Run `node --test tests/test_community_v2.js`, confirm failures identify missing behavior.
- [x] Implement protocol with injected transport/store for testability, strict token/header separation and bounded errors.
- [x] Run new and existing protocol suites; expect all pass.

### Task 2: Desktop/Android native transport and storage
**Files:** Create src/system/CommunityBridge.h/.cpp, native/communityBridge.js, Android CommunityBridge.kt; modify SystemComponent.h/.cpp, src/CMakeLists.txt, BridgeDispatcher.kt, androidBridge.js, WebHost.kt. Tests: native bridge policy/store, node bridge adapter, Android JVM policy.
**Interfaces:** system `communityRequest(id, request)` emits `communityResponse(id, result)` with `{status,headers,body,error}`; `communityCancel(id)`; `communityCredential(operation,key,value)` returns `{ok,value}`; `communitySetEmbySession(session)` returns bool. JS adapter exposes `transport(path, options)` and `store.read/write/remove(key)` promises. Only v2 relative paths and mapping capabilities accepted.
- [x] Pin allowlist, redirects, size limits and callback/Promise bridging in failing tests.
- [x] Implement native networking, profile-isolated platform credentials, page/epoch cancellation; add shared script bootstrapping.
- [x] Configure/build native targets and run bridge tests with runtime preflight; run Android unit/build checks when tooling available.

### Task 3: Login and public/private discussion UI
**Files:** Modify native/communityPlugin.js; create native/communityAccount.js; extend tests/test_community_v2_ui.cjs.
**Interfaces:** Single session singleton updates from connectionManager; account view requests login/register/password/logout through Task1. Client selection public by default; private remains Dahe only. Media identity resolves parent series before public topic.
- [x] Add failing fixture tests for automatic exchange, external login, capabilities failure, scope switch and missing media identity.
- [x] Integrate account controls and discussion client routing; preserve existing private reports and admin surface only on private channel.
- [x] Run real WebEngine UI fixtures and existing community UI suite, expect correct routing/content and no private headers on public business calls.

### Task 4: Mapping session authorization
**Files:** Modify PlayerComponent mapping setup, Lua mapping.lua/probes, Android SharedDanmakuMapping.kt/DanmakuRepository.kt; add native/Lua/Android tests.
**Interfaces:** Task2 owns current trusted Emby identity. Native private temporary header path and auth generation exposed to mpv; Lua manual selection adds all three headers via file. Account changes cancel prior response. Android transport injects same three headers only for trusted mapping write.
- [x] Fail tests for no static JSON required, session switch cancellation, external token isolation and429 no bypass.
- [x] Implement capability-aware session mode plus explicit legacy fallback only when eligible.
- [x] Run runtime mapping tests and ordinary session production validation if a legitimate account is available; otherwise report that limitation.

### Task 5: Messages and cross-server navigation
**Files:** Modify native/communityMessages.js/communityPlugin.js; extend v2 protocol and UI fixtures.
**Interfaces:** Dahe uses v1 unified list only; external uses public client. `locateMedia(api, media)` accepts only unique matching current-library metadata. Unresolved location opens standalone public topic with explicit navigation notice.
- [x] Add failing tests for no duplicate badge, explicit mark read, snapshot errors, unique local identity lookup and missing/ambiguous target.
- [x] Implement account-aware messages and public discussion fallback; maintain private report flows.
- [x] Run message and pagination regression suites.

### Task 6: Integration, review and package
**Files:** Update docs/reports/2026-10-12-community-v2-client-validation.md, integration manifests and portable archive.
- [x] Run applicable full Windows CTest, node tests and Android verification; record skips and platform limitations.
- [x] Request one fresh final code review, repair material findings with regression tests.
- [x] Install staged build, create preview ZIP, inspect absence of credentials, standalone smoke with isolated profile.
- [x] Record production read-only capability results separately from fixtures and actual playback/exit checks. Deliver package and evidence; no push/merge required.

Implementation changes stay uncommitted with the existing preview work until final review, preserving a single reviewable change set.

完成记录：Windows 79/79，Node 42/42，Android JVM 114/114，Lint 0 errors / 41 warnings；真实 NAS 原生会话与 Lua 下一集复用、独立 ZIP 启动通过。实际覆盖与未验证的平台、公网和生产发评限制以 docs/reports/2026-10-12-community-v2-client-validation.md 为准。
