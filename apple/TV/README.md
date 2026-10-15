# Apple TV development client

The native television client is under development on `codex/tvos-client`; it is not part of the published Mac/iPad2.7.0 attachments. Requires tvOS26+ and Xcode27. The independent `TigerestTV.xcodeproj` shares AppleCore and the pinned MPVKit revision with iPad without importing its WebHost or touch controls.

Implemented: dedicated/self-host server selection from shared bundled defaults, Emby login and device-local Keychain session, library/continue-watching, paginated folders, series/seasons/episodes with SXXEXX labels, detail/play/resume, native Metal playback, remote play/pause, ±10-second seek, back/exit, progress reporting and immediate local resume updates. API calls preserve reverse-proxy paths; media requests do not carry custom authentication headers to external servers. Passwords are not stored.

## Build

Select the installed Xcode27 Developer directory using `DEVELOPER_DIR` (beta is supported), then from repository root:

```sh
python3 apple/tools/generate_tv_project.py
xcodebuild -project apple/TigerestTV.xcodeproj -scheme TigerestTV \
  -configuration Release -derivedDataPath apple/DerivedDataTV \
  -clonedSourcePackagesDirPath apple/DerivedData/SourcePackages \
  -sdk appletvos -destination 'generic/platform=tvOS' CODE_SIGNING_ALLOWED=NO build
```

For device installation, pair the Apple TV in Xcode, choose the existing Personal Team through local `apple/Local.xcconfig`, and build with signing enabled. The generator does not embed personal signing settings. Device provisioning, trust and a real login must be completed before claiming hardware playback validation.

## Tests

```sh
(cd apple/Core && swift test)
```

For isolated UI/playback checks, generate a local45-second720p/24 H.264/AAC fixture and opt it into the project:

```sh
python3 apple/tools/generate_tv_project.py --fixture-media /absolute/path/fixture.mp4
xcodebuild -project apple/TigerestTV.xcodeproj -scheme TigerestTV \
  -derivedDataPath apple/DerivedDataTV \
  -clonedSourcePackagesDirPath apple/DerivedData/SourcePackages \
  -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' test
python3 apple/tools/generate_tv_project.py
```

The three tests use actual `XCUIRemote` directional/select/play-pause/menu events. They check season/episode and focus restoration, both server-entry forms, and advancing video position followed by pause/resume/exit and updated resume position. `--tv-fixture` neither loads nor writes Keychain credentials; local playback in this mode skips server reports. The optional test file is removed from project resources by normal generation. Keep test data separate from real media and credentials.

## Verified scope and remaining work

2026-10-15: Xcode27.2 beta, tvOS27.2 simulator; shared Swift62 tests pass, native UI3/3 pass using local generated media. Release builds succeed for both simulator and Apple TV device architectures. The app declares tvOS26.0, device family3, version2.7.0(270), and contains no fixture media. Personal Team signing, wireless installation and normal startup were also verified on an Apple TV 4K (2nd generation), tvOS27.0. Real-server login, hardware playback and physical tvOS26 execution have not yet been verified; simulator/local fixture results do not cover those checks.

This first increment supports original direct-play/direct-stream media; it does not start transcoders or open live-TV sessions. RIFE, native danmaku, offline downloads, community features, multiple profiles, track-selection settings and full visual parity are not yet ported. Playback errors and inaccessible servers are shown with retry paths. Final stop-progress delivery is best effort if the app loses network access or is suspended by the system.
