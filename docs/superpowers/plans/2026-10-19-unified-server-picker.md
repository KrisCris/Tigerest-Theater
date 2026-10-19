# Unified server picker and client controls implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement task by task. The user explicitly selected Claude implementation after the read-only design review; Codex owns independent verification and delivery. No simultaneous product editing.

**Goal:** A user can switch among remembered Emby and Jellyfin servers from one clearly named client entry, without navigating either server's own server-list UI.

**Architecture:** Extend the existing native chooser and per-profile settings. Preserve the current native selection transaction: validate connectivity, navigate, then commit the successful server; cancellation/failure preserves the previous address and credentials. Consolidate client-owned controls into a named menu instead of adding more permanent header buttons.

**Tech Stack:** Shared JavaScript/CSS, Qt/C++/QML, Android Kotlin/WebView; Apple consumes the contract and implements its native SwiftUI chooser separately.

**Spec:** User requests in this conversation: improve overall button design; remember all previously connected Emby/Jellyfin servers in the client chooser; avoid their stock server-list pages. User explicitly authorized Claude to implement after reviewing the proposed direction. Default startup remains the last successful server; chooser is explicit. Claude's read-only review in the same session provides supporting implementation suggestions, not mandatory extra scope.

## Baseline and ownership

- Start at `31e7c46f4114ecef92bebcfff92b6e6b214705fb`, workspace `.claude/worktrees/jellyfin-290`, branch `claude/jellyfin-2.9.0`. Do not use the parent branch.
- `4db34c7` was already delivered to Mac with a verified bundle. `31e7c46` fixes the branded header overlap and temporarily exposes a direct server button. Its behavior may be replaced by the agreed consolidated menu; keep the layout fix and tests.
- Claude is sole product writer for this round after receipt of Codex's explicit handoff. Codex only maintains verification/handoff docs and external evidence while Claude implements. Do not edit Codex's existing verification docs or external scripts.
- Do not push, merge or release. Do not install/run on the phone, use production profiles, or start native/full builds. Claude runs targeted Node/browser tests; Codex runs isolated native builds and device validation after explicit delivery.

## Global constraints

- Preserve installed stable clients and all existing user settings and sessions. History stores metadata, never passwords, tokens or cookies.
- History belongs to the current client profile. Server records and authentication profiles are distinct; do not reuse one profile's data for another.
- Native chooser's origin is different from remote pages. Use native settings, not only origin-local `localStorage`.
- Keep Android native address EditText and its cancellation behavior. Do not change system keyboard/WebView settings.
- Only successfully loaded server pages become successful history entries. API success followed by HTML/network/SSL failure must roll back current selection and must not add a success entry.
- Migrate the one currently saved address honestly. Historical servers that were never retained cannot be invented or recovered by guessing.
- Preserve the dedicated server's LAN/public fallback as one logical entry. Self-hosted connection failures never fall back to that dedicated server.
- Removing a history record does not log out, erase web data or delete server content. Clearly label it; require in-app confirmation. Do not allow removal of the active server to leave an invalid startup target.
- Server names and metadata are untrusted: render text safely, validate URLs, disallow embedded credentials; preserve scheme, IPv6, port and base path.
- Do not claim Apple validation on Windows. Apple app currently has a native chooser; document equivalent methods/schema and resource synchronization for Mac.

## Review focus

- Identical host with different base paths must remain separate unless a trusted same-server identity and user intent support merging; never merge solely on hostname.
- Failed/cancelled/slow or out-of-order attempts cannot change current settings or remembered successful target.
- A previously saved server can be offline: show a recoverable card error without losing its address or the rest of the list.
- Cold start, explicit switch, login expired, logout, and server-native selectserver routes must be tested separately; suppressing `multiserver` blindly could break login.
- Folded/narrow and expanded/desktop headers must have one reachable menu, visible focus, accessible labels, no overflow, and no repeated full-page scans during media mutations.

## Task 1: Remembered-server model and persistence

**Files:** new shared `native/serverHistory.js` and tests; existing `native/find-webclient.js`, `native/servers.js`/connectivity helper as applicable; `resources/settings/settings_description.json`, Qt SystemComponent/QML selection transaction, Android `SettingsPolicy.kt`, `WebHost.kt`, `BridgeDispatcher.kt`.

- [ ] Pin a versioned JSON schema in a small contract document: stable record key, server identity/type when known, display name, validated address(es), mode, last successful address/time. Avoid speculative fields/API methods that no caller needs.
- [ ] Add failing tests for canonical URL deduplication, ports/IPv6/base paths, unknown type, hostile names, migration, same-server aliases, two different servers with similar names, invalid persisted JSON, and profile isolation.
- [ ] Implement pure normalization/merge functions plus native persisted storage. Write only at the successful transaction boundary, with cancellation/failure tests. If adding native bridge methods, define parameter/return/error contracts and document Apple equivalents.
- [ ] Run targeted tests and report exact commands/results. Commit the independently working model and native integration.

## Task 2: Unified chooser UI and navigation

**Files:** `native/find-webclient.html`, `.js`, language resources; native asset/resource registration; tests `test_server_onboarding.js`, `test_server_onboarding_webengine.js` (prepare, do not run native executable), and a browser layout test.

- [ ] Add failing cases for saved-server selection, last-used startup, explicit `choose=1`, add/retry/edit, offline errors, remove confirmation, cancel/Back, successful switch and failed HTML rollback.
- [ ] Present remembered server cards with name, type and concise address; mark current server. Keep an add-server action and the dedicated server. Do not probe every server continuously or block rendering for reachability.
- [ ] Reuse `connectServers`/`finishServerSelection`; keep Android native editor and existing rollback behavior. Preserve user sessions at their original origins.
- [ ] Route client-facing switch controls and stock server-list entry points into this chooser without suppressing actual authentication pages. Test Emby and Jellyfin separately, including login expired and logout. Keep browser/back history bounded.
- [ ] Run targeted Node/browser tests and commit.

## Task 3: Consolidated client menu

**Files:** `native/nativeshell.js`, `native/homeGallery.js`, Android responsive assets if required; existing header/home/settings UI tests and `test_server_switch_entry_ui.cjs`.

- [ ] Write failing behavior/layout tests before replacing the temporary JF17 entry. Check menu open/close, keyboard/Back/Escape, replaced headers, hidden/disabled actions, and routing to the native chooser.
- [ ] Use a clearly named client menu; first item shows current server and “切换/管理服务器”, followed by player settings, offline media, desktop window mode and update where available. Keep essential media controls. Avoid arbitrarily hiding server-provided actions.
- [ ] Home has a current-server entry with the same chooser behavior. No duplicate visible entry when the native header is hidden. Compact screens use the same hierarchy and accessible text labels.
- [ ] Logged-out pages keep a lightweight switch action and do not gain an unnecessary empty toolbar. Preserve JF17 theme padding/tab correction and JF14 clearance.
- [ ] Verify 390/600/847/948/1280 widths, Emby unchanged playback/navigation, no unnecessary layout work on media mutations; commit.

## Task 4: Explicit delivery to Codex

- [ ] Give final commit SHA, files changed, actual targeted test results, known limitations, and clean/dirty/untracked state. Stop editing after handoff.
- [ ] Include the shared data/bridge contract and exact Apple-native work still needed. Do not edit Apple product files while Mac is working independently unless explicitly coordinated.
- [ ] Codex reviews diff, fixes issues via Claude if available, builds Windows/Android in isolation, validates real devices/API separately from fixtures, preserves user trial profiles, installs approved debug updates, and exports validated incremental Mac bundle with SHA/manifest.

## Already verified before this round

`31e7c46`: branded toolbar regression red (64 failures) then Chrome five widths green; Qt layout/home/entry/entrance 4/4 (41.76 seconds); browser entry/header tests green. Android APK SHA256 `dcc7d20767d67838de712190e23f0f95a514fc4a80205c1bc1e90399e399e6f4`, install-r succeeded and native page reports one visible server entry and nonoverlapping top/tabs. Screenshot CDP disconnect does not imply an app crash; PID remained 26961 and exit-info showed no new process exit. Full final transaction device checks and Windows user-instance refresh still belong to Codex. Previous real playback matrices remain historical evidence, not tests rerun at this commit.
