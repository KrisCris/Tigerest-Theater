# Apple TV development client

The native television client is under development on `codex/tvos-client`; it is not part of the published Mac/iPad2.7.0 attachments. Requires tvOS26+ and Xcode27. The independent `TigerestTV.xcodeproj` shares AppleCore and the pinned MPVKit revision with iPad without importing its WebHost or touch controls.

Implemented: dedicated/self-host server selection from shared bundled defaults, Emby login and device-local Keychain session, original library artwork and a focus-driven home hero/poster rail with continue-watching/latest ordering, a recursive paginated poster wall, series/seasons/episodes with SXXEXX labels, rich details with available year/runtime/genre/people/media metadata, in-place season/episode selection, detail/play/resume, native Metal playback, remote play/pause, ±10-second seek, previous/next episodes and a season-aware episode picker, back/exit, progress reporting and immediate local resume updates. API calls preserve reverse-proxy paths; media requests do not carry custom authentication headers to external servers. Passwords are not stored. Subtitle tracks preserve Emby defaults and use actual MPV track IDs, with embedded/external selection, explicit off, timing adjustment and non-fatal failure messages. The shared iPad danmaku repository, matching rules, glyph renderer and playback clock are reused, with TV search/source/offset controls. Native comments support private/public feeds, work/episode contexts, paging, replies, sending and deleting owned comments. Public credentials use a separate Keychain record and token-refresh lifecycle; no Emby token is sent to public or arbitrary danmaku providers. Comments are inline below detail information with a shared vertical scrolling surface, and quality settings are available outside playback. RIFE is not linked or bundled.

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

For isolated UI/playback/subtitle checks, generate a local 45-second 720p/24 H.264/AAC fixture with a Chinese mov_text subtitle track (requires ffmpeg), then opt it into the project:

```sh
python3 apple/tools/generate_tv_test_media.py /absolute/path/fixture.mp4
python3 apple/tools/generate_tv_project.py --fixture-media /absolute/path/fixture.mp4
xcodebuild -project apple/TigerestTV.xcodeproj -scheme TigerestTV \
  -derivedDataPath apple/DerivedDataTV \
  -clonedSourcePackagesDirPath apple/DerivedData/SourcePackages \
  -destination 'platform=tvOS Simulator,name=Apple TV 4K (3rd generation)' test
python3 apple/tools/generate_tv_project.py
```

The seven tests use actual `XCUIRemote` directional/select/play-pause/menu events. They check season/episode and focus restoration, both server-entry forms, and advancing video position followed by pause/resume/exit and updated resume position, plus real player episode switching, replacing detail selections across seasons without growing the return stack, home preview/hero navigation, returning from home details to the selected library poster, the quality panel and selecting/disabling an actual embedded subtitle. The subtitle test retains a screenshot for visual inspection. `--tv-fixture` neither loads nor writes Keychain credentials; local playback in this mode skips server reports. The optional test file is removed from project resources by normal generation. Keep test data separate from real media and credentials.

## Verified scope and remaining work

2026-10-15, Xcode27.2 beta: shared AppleCore 100 tests, five danmaku host tests, twenty-eight home/episode-model tests, twenty-three playback/subtitle-controller tests and seven comments-model tests passed. All seven native remote UI tests passed; the subtitle test also passed again after the font fix, and its screenshot was inspected to confirm correctly rendered Chinese text. Controller tests cover quality rollback, generation handoff, subtitle track selection, pending external loads and diagnostic isolation. Native remote UI tests use generated local media, not production server playback. Both signed device TV and iPad Release builds passed after the shared danmaku extraction.

The TV bundle includes unmodified Source Han Sans SC under its SIL Open Font License so text subtitles do not depend on unavailable system CJK fallback fonts. ASS styles and embedded fonts remain enabled. Source revision and hash are recorded in `apple/Resources/SubtitleFonts/README.md`.

On the paired Apple TV 4K (2nd generation / A12), tvOS27.0, the final signed non-fixture build was installed and launched normally, preserving the existing login. The original home artwork/hero/rail, library poster wall, series/season/episode navigation, S01E01 labels, current-episode selection, inline comments below media information, and return to the originating library poster were checked on this build. Earlier physical checks verified actual private/public comment reads and automatic danmaku: the sampled episode loaded 6,810 entries, video and danmaku rendered together, and the remote paused playback. No production comment was posted or deleted: mutation and retry behavior was verified with controlled fixtures. Physical tvOS26 execution and old-system runtime have not been tested.

The desktop default catalog and its SSim/Krig/RAVU shader files are bundled unchanged. Their execution depends on source/output dimensions. Actual A12/4K testing found substantial render drops with the full chain; decoder drops stayed zero and cache stayed full. The full-resolution low-cost scaling comparison kept its 3840×2160 drawable and recorded zero render/decoder drops through 110.652 seconds with danmaku enabled; this is a sampled HEVC 1080p episode, not an all-media performance guarantee. Native TV quality uses this lower-cost scaling by default, while the unchanged full desktop preset remains selectable. Do not infer smooth performance merely from successful shader attachment. Explicit diagnostic launches can write an allowlisted `Library/Caches/tv-playback-probe.json`; normal launches do not write it, and the file reports actual drawable size, scalers and render passes. URLs, headers, titles and account data are excluded.

This development client supports original direct-play/direct-stream media; it does not start transcoders or open live-TV sessions. Offline downloads, multiple profiles, public account registration, moderation/admin controls, audio-track selection and full desktop feature parity remain outside this increment. Playback errors and inaccessible servers are shown with retry paths. Final stop-progress delivery is best effort if the network disappears or the system suspends the app. This television client remains separate from the published Mac/iPad2.7.0 attachments.
