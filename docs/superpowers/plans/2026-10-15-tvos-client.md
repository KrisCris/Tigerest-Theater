# Apple TV Client Implementation Plan

**Goal:** Produce a buildable, remote-operable first television client after Apple2.7.0 publication.
**Architecture:** Shared Foundation EmbyClient + native focus UI + reused MPVEngine.
**Tech Stack:** Swift/SwiftUI, tvOS26+, Xcode27, pinned MPVKit.
**Spec:** docs/superpowers/specs/2026-10-15-tvos-client.md
**Authorization:** User explicitly requested implementation after publication; routine development, isolated testing and device installation are within that request.

## Constraints and review

Preserve iPad generated project, installed profiles, MPV revision and deployment floors. Do not log credentials or send auth to unrelated stream origins. Restore a usable UI after failed login/playback; preserve reverse-proxy base paths; ignore stale navigation loads; report final playback progress when closing/backgrounding. Only physical tests count as Apple TV playback verification.

## Work

- [x] Shared client: add AppleCore Emby/EmbyClient.swift and EmbyClientTests.swift; write failing URLProtocol contract tests; implement bounded transport/models; run focused and full Swift tests. API contract in spec.
- [x] Native browsing: apple/TV/TVAppModel.swift, TVRootView.swift, TVSessionStore.swift; dedicated/self-host selection, Keychain restoration, load/retry, focusable item cards and SXXEXX; compile against shared client contract.
- [x] Playback/project: apple/TV/TVPlaybackController.swift, TVPlayerView.swift, TigerestTVApp.swift; separate Config/TVInfo.plist and tools/generate_tv_project.py; reuse MPVEngine; pause/seek/back and serialized session reporting. Add tvOS to Core platform metadata.
- [x] Verify: build tvOS simulator/device, run API tests and isolated native UI/playback fixtures. Independently review authentication/progress/lifecycle and fix findings before commit/PR.
- [x] Pair/install physical Apple TV and verify normal startup.
- [ ] Verify production-server login and physical picture/sound/remote operation.
- [x] Record exact completed scope and gaps; push TV branch and attach draft PR#9 without publishing an unvalidated TV release.

## Validation record

- Shared Swift suite62/62; includes18 Emby tests and explicit resume item types, path-prefix/auth/query handling, CDN signatures and reporting fixtures.
- First simulator build found a caught-error shadowing assignment; fixed. First UI run passed browsing, exposed unreachable toolbar focus and inherited accessibility identifiers hiding player button IDs; fixed production focus section and identifier placement.
- Second simulator UI run3/3 passed with actual remote input and local decoded/rendered video, including frozen position while paused and restored progress after exit.
- Release device architecture build succeeded with signing disabled; Info.plist confirms tvOS26.0/family3/version2.7.0(270), and the final app contains no fixture media. The independent generator leaves the iPad project unchanged.
- Independent review found stale resume metadata, unavailable final time-pos overwriting progress with zero, and stripping unrelated CDN signature tokens. All three were fixed; regression tests/fixture checks added where applicable.
- Apple TV 4K (2nd generation), tvOS27.0: paired via Device Hub, built with the existing Personal Team, installed wirelessly and launched normally. The full-resolution device screenshot confirms the native server-choice screen. User is completing real login/playback; those results remain pending.
