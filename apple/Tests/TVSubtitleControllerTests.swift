import XCTest
import AppleCore
@testable import SharedTVPlayback

@MainActor final class TVSubtitleControllerTests: XCTestCase {
    private func playback(_ tracks: [EmbySubtitleTrack] = [], defaultIndex: Int? = nil) -> EmbyPlayback {
        EmbyPlayback(url: URL(fileURLWithPath: "/tmp/fixture.mp4"), headers: [:], item: .null,
                     mediaSourceID: "source", playSessionID: "session", startSeconds: 0,
                     subtitleTracks: tracks, defaultSubtitleStreamIndex: defaultIndex)
    }
    private func track(_ id: Int, ff: Int? = nil, lang: String = "zho", external: URL? = nil) -> JSONValue {
        var value: [String: JSONValue] = ["id": .number(Double(id)), "type": .string("sub"), "lang": .string(lang),
            "title": .string("中文字幕"), "codec": .string("subrip"), "selected": .bool(false), "external": .bool(external != nil)]
        if let ff { value["ff-index"] = .number(Double(ff)) }
        if let external { value["external-filename"] = .string(external.absoluteString) }
        return .object(value)
    }
    func testEmbeddedServerIndexUsesActualSIDAndExplicitOffStaysOff() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let metadata = EmbySubtitleTrack(index: 7, embeddedIndex: 1, title: "中文字幕", language: "chi", codec: "srt")
        subtitles.begin(playback: playback([metadata], defaultIndex: 7), engine: engine)
        engine.properties["track-list"] = .array([track(2, ff: 7)])
        subtitles.fileLoaded(); subtitles.update()
        XCTAssertEqual(engine.string("sid"), "2")
        XCTAssertEqual(subtitles.selectedID, subtitles.options.first?.id)
        subtitles.select(nil)
        XCTAssertEqual(engine.string("sid"), "no")
        XCTAssertNil(subtitles.selectedID)
        for defaultIndex: Int? in [nil, -1] {
            subtitles.begin(playback: playback([metadata], defaultIndex: defaultIndex), engine: engine)
            subtitles.fileLoaded(); subtitles.update()
            XCTAssertEqual(engine.string("sid"), "no")
            XCTAssertNil(subtitles.selectedID)
        }
    }
    func testExternalWaitsForTrackListAndCanBeCancelledBeforeArrival() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let url = URL(string: "https://fixture.example/subtitles/7.srt?api_key=fixture")!
        let metadata = EmbySubtitleTrack(index: 7, externalURL: url, title: "外挂中文", language: "chi", codec: "srt", isExternal: true)
        subtitles.begin(playback: playback([metadata], defaultIndex: 7), engine: engine)
        subtitles.fileLoaded()
        XCTAssertTrue(subtitles.isLoading)
        XCTAssertNil(subtitles.selectedID)
        XCTAssertEqual(engine.commands.last?.prefix(3), ["sub-add", url.absoluteString, "auto"])
        engine.properties["track-list"] = .array([track(5, external: url)])
        subtitles.update(); subtitles.update()
        XCTAssertFalse(subtitles.isLoading)
        XCTAssertEqual(engine.string("sid"), "5")
        XCTAssertNotNil(subtitles.selectedID)
        subtitles.begin(playback: playback([metadata], defaultIndex: 7), engine: engine)
        engine.properties["track-list"] = .array([])
        subtitles.fileLoaded(); subtitles.select(nil)
        engine.properties["track-list"] = .array([track(9, external: url)])
        subtitles.update()
        XCTAssertEqual(engine.string("sid"), "no")
        XCTAssertNil(subtitles.selectedID)
    }
    func testMissingMetadataStillExposesRealEmbeddedTracks() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        subtitles.begin(playback: playback(), engine: engine)
        engine.properties["track-list"] = .array([track(1, ff: 2)])
        subtitles.fileLoaded()
        let option = try XCTUnwrap(subtitles.options.first)
        XCTAssertEqual(option.accessibilityID, "tv.subtitles.track.1")
        subtitles.select(option); subtitles.update()
        XCTAssertEqual(engine.string("sid"), "1")
        XCTAssertEqual(subtitles.selectedID, option.id)
    }
    func testContradictingFFIndexDoesNotBlindlyUseOrdinal() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let metadata = EmbySubtitleTrack(index: 7, embeddedIndex: 1, title: "中文", language: "zho", codec: "srt")
        subtitles.begin(playback: playback([metadata], defaultIndex: 7), engine: engine)
        engine.properties["track-list"] = .array([track(1, ff: 8, lang: "eng")])
        subtitles.fileLoaded(); subtitles.update(now: ProcessInfo.processInfo.systemUptime + 31)
        XCTAssertEqual(engine.string("sid"), "no")
        XCTAssertNotNil(subtitles.error)
        XCTAssertFalse(engine.closed)
    }
    func testNewMediaDiscardsOldSelectionAndPendingExternalLoad() throws {
        let engine = try MPVEngine(), next = try MPVEngine(), subtitles = TVSubtitleController()
        let url = URL(string: "https://fixture.example/sub.srt")!
        let metadata = EmbySubtitleTrack(index: 7, externalURL: url, title: "外挂", isExternal: true)
        subtitles.begin(playback: playback([metadata]), engine: engine); subtitles.fileLoaded()
        let stale = try XCTUnwrap(subtitles.options.first)
        subtitles.select(stale)
        subtitles.begin(playback: playback(), engine: next); subtitles.fileLoaded()
        engine.properties["track-list"] = .array([track(4, external: url)])
        subtitles.select(stale); subtitles.update()
        XCTAssertEqual(next.string("sid"), "no")
        XCTAssertTrue(subtitles.options.isEmpty)
        XCTAssertFalse(subtitles.isLoading)
    }
    func testSubtitleFailureDoesNotStopVideo() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let metadata = EmbySubtitleTrack(index: 4, externalURL: URL(string: "https://fixture.example/sub.srt"), title: "外挂", isExternal: true)
        subtitles.begin(playback: playback([metadata], defaultIndex: 4), engine: engine)
        engine.failCommands = ["sub-add"]
        subtitles.fileLoaded()
        XCTAssertNotNil(subtitles.error)
        XCTAssertFalse(subtitles.isLoading)
        XCTAssertFalse(engine.closed)
    }
    func testAcceptedExternalCommandStillTimesOutWithoutARealTrack() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let metadata = EmbySubtitleTrack(index: 4, externalURL: URL(string: "https://fixture.example/sub.srt"), title: "外挂", isExternal: true)
        subtitles.begin(playback: playback([metadata], defaultIndex: 4), engine: engine)
        subtitles.fileLoaded()
        XCTAssertTrue(subtitles.isLoading)
        XCTAssertNil(subtitles.selectedID)
        subtitles.update(now: ProcessInfo.processInfo.systemUptime + 31)
        XCTAssertFalse(subtitles.isLoading)
        XCTAssertNotNil(subtitles.error)
        XCTAssertNil(subtitles.selectedID)
        XCTAssertFalse(engine.closed)
        subtitles.select(try XCTUnwrap(subtitles.options.first))
        XCTAssertEqual(engine.commands.filter { $0.first == "sub-add" }.count, 2, "A failed async load can be retried")
    }
    func testOrdinalFallbackRequiresCompleteUnambiguousEvidence() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        let chinese = EmbySubtitleTrack(index: 7, embeddedIndex: 1, title: "中文", language: "chi", codec: "srt")
        let english = EmbySubtitleTrack(index: 8, embeddedIndex: 2, title: "English", language: "eng", codec: "srt")
        subtitles.begin(playback: playback([chinese, english], defaultIndex: 7), engine: engine)
        engine.properties["track-list"] = .array([track(1), track(2, lang: "eng")])
        subtitles.fileLoaded(); subtitles.update()
        XCTAssertEqual(subtitles.selectedID, "emby.7")
        let ambiguous = EmbySubtitleTrack(index: 8, embeddedIndex: 2, title: "中文 2", language: "zho", codec: "srt")
        subtitles.begin(playback: playback([chinese, ambiguous], defaultIndex: 7), engine: engine)
        engine.properties["track-list"] = .array([track(1), track(2)])
        subtitles.fileLoaded()
        XCTAssertNil(subtitles.options.first?.mpvID)
        XCTAssertEqual(engine.string("sid"), "no")
        XCTAssertEqual(subtitles.options.filter { $0.id.hasPrefix("mpv.") }.count, 2, "Unmapped tracks remain manually selectable")
    }
    func testDelayIsBoundedAndResetsBetweenMedia() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        subtitles.begin(playback: playback(), engine: engine); subtitles.fileLoaded()
        subtitles.adjustDelay(by: 0.5)
        XCTAssertEqual(subtitles.delay, 0.5)
        subtitles.adjustDelay(by: .infinity)
        XCTAssertEqual(subtitles.delay, 0.5)
        subtitles.adjustDelay(by: 100)
        XCTAssertEqual(subtitles.delay, 60)
        subtitles.adjustDelay(by: -200)
        XCTAssertEqual(subtitles.delay, -60)
        subtitles.begin(playback: playback(), engine: engine)
        XCTAssertEqual(subtitles.delay, 0)
        XCTAssertEqual(engine.string("sub-delay"), "0")
    }
    func testBundledCJKFontIsConfiguredWithoutOverridingASSLayout() throws {
        let engine = try MPVEngine(), subtitles = TVSubtitleController()
        subtitles.begin(playback: playback(), engine: engine)
        XCTAssertEqual(engine.string("sub-font"), "Source Han Sans SC")
        XCTAssertEqual(engine.string("sub-scale"), "1.15")
        XCTAssertEqual(engine.string("sub-fonts-dir"), Bundle.main.resourceURL?.appending(path: "SubtitleFonts").path)
        XCTAssertEqual(engine.string("sub-ass-override"), "no")
        XCTAssertEqual(engine.string("sub-ass-style-overrides"), "")
        XCTAssertEqual(engine.string("sid"), "no", "Bundling a font must not enable a subtitle by itself")
        XCTAssertFalse(engine.closed)
    }
}
