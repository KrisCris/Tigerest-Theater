import XCTest
import Combine
import AppleCore
@testable import SharedTVPlayback

/// Production controller with engine/platform doubles; real rendering and
/// production networking remain separate device checks.
@MainActor final class TVPlaybackControllerTests: XCTestCase {
    private let native = ["scale": "bilinear", "cscale": "bilinear", "dscale": "bilinear", "glsl-shaders": "", "deband": "no", "sigmoid-upscaling": "no"]
    private var desktop: [String: String] {
        var settings = TVQualityPreset().options
        settings["glsl-shaders"] = TVQualityPreset.shaderPaths.joined(separator: ":")
        return settings
    }
    private func withPreference(_ preference: String?, body: () throws -> Void) rethrows {
        let previous = UserDefaults.standard.object(forKey: "tv.qualityPreset")
        defer { UserDefaults.standard.set(previous, forKey: "tv.qualityPreset") }
        UserDefaults.standard.set(preference, forKey: "tv.qualityPreset")
        try body()
    }
    private func playFixture(_ player: TVPlaybackController) throws {
        let session = EmbySession(serverURL: "https://fixture.example", userID: "user", accessToken: "fixture", deviceID: "device")
        let media = EmbyPlayback(url: URL(fileURLWithPath: "/tmp/fixture.mp4"), headers: [:], item: .object([:]), mediaSourceID: "source", playSessionID: "session", startSeconds: 0)
        try player.play(media, client: EmbyClient(session: session))
    }
    func testMultichannelOutputIsRequestedAndRenegotiatedOnRouteChange() async throws {
        let audio = AVAudioSession.sharedInstance()
        audio.supportsMultichannelContent = false; audio.preferredOutputChannels = 0; audio.maximumOutputNumberOfChannels = 6
        let player = TVPlaybackController(arguments: ["--tv-fixture"])
        try playFixture(player); defer { player.stop() }
        XCTAssertTrue(audio.supportsMultichannelContent, "5.1/7.1 must reach the route for spatial audio")
        XCTAssertEqual(audio.preferredOutputChannels, 6)
        audio.preferredOutputChannels = 0; audio.maximumOutputNumberOfChannels = 2
        NotificationCenter.default.post(name: AVAudioSession.routeChangeNotification, object: nil,
                                        userInfo: [AVAudioSessionRouteChangeReasonKey: AVAudioSession.RouteChangeReason.newDeviceAvailable.rawValue])
        for _ in 0..<50 where player.engine?.commands.contains(["ao-reload"]) != true { await Task.yield() }
        XCTAssertEqual(player.engine?.commands.filter { $0 == ["ao-reload"] }.count, 1, "a new route reopens the audio output")
        XCTAssertEqual(audio.preferredOutputChannels, 2)
    }
    func testFreshDefaultIsNativeWithoutPersistingOrReducingDrawable() throws {
        try withPreference(nil) {
            let player = TVPlaybackController(arguments: [])
            XCTAssertEqual(player.qualityPreset, "native")
            player.surface.metal.drawableSize = CGSize(width: 3840, height: 2160)
            try playFixture(player); defer { player.stop() }
            XCTAssertEqual(player.engine?.appliedQuality, native)
            XCTAssertNil(UserDefaults.standard.object(forKey: "tv.qualityPreset"))
            XCTAssertEqual(player.playbackProbe()["drawableSize"], .object(["width": .number(3840), "height": .number(2160)]))
            XCTAssertEqual(player.playbackProbe()["scalers"], .object(["scale": .string("bilinear"), "cscale": .string("bilinear"), "dscale": .string("bilinear")]))
        }
    }
    func testFixtureQualityDoesNotReadOrOverwriteInstalledPreference() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: ["--tv-fixture"])
            XCTAssertEqual(player.qualityPreset, "native")
            player.selectQuality("tv-balanced")
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tigerest-default")
        }
    }
    func testLightweightSelectionSurvivesRelaunchAndKeepsFourKOutput() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            player.surface.metal.drawableSize = CGSize(width: 3840, height: 2160)
            try playFixture(player); defer { player.stop() }
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            XCTAssertEqual(player.engine?.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
            XCTAssertEqual(player.engine?.appliedQuality["deband"], "no")
            XCTAssertEqual(player.surface.metal.drawableSize, CGSize(width: 3840, height: 2160))
        }
    }
    func testDesktopLightweightNativeRoundTripClearsHeavyProcessing() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = try XCTUnwrap(player.engine)
            player.selectQuality("tv-balanced")
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tv-balanced")
            XCTAssertEqual(engine.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
            XCTAssertEqual(engine.appliedQuality["cscale"], "bilinear")
            player.selectQuality("native")
            XCTAssertEqual(engine.appliedQuality, native)
            player.selectQuality("tigerest-default")
            XCTAssertEqual(engine.appliedQuality, desktop)
        }
    }
    private func sample(_ player: TVPlaybackController, at time: Double, position: Double? = nil,
                        drops: Double = 0, decoderDrops: Double = 0, fps: Double = 24,
                        paused: Bool = false, buffering: Bool = false) {
        let engine = player.engine!
        engine.properties["time-pos"] = .string(String(position ?? time))
        engine.properties["estimated-vf-fps"] = .string(String(fps))
        engine.properties["frame-drop-count"] = .string(String(drops))
        engine.properties["decoder-frame-drop-count"] = .string(String(decoderDrops))
        engine.properties["pause"] = .bool(paused)
        engine.properties["paused-for-cache"] = .bool(buffering)
        player.tick(now: time)
    }
    func testHighFrameRateAutomaticallyReducesOnlyEffectiveLightweightQuality() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.surface.metal.drawableSize = CGSize(width: 3840, height: 2160)
            player.engine!.pendingEvents = [.loaded]
            for second in 0...4 { sample(player, at: Double(second), fps: 60) }
            XCTAssertEqual(player.engine!.appliedQuality, native)
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tv-balanced")
            XCTAssertEqual(player.playbackProbe()["effectiveQualityPreset"].string, "native")
            XCTAssertEqual(player.surface.metal.drawableSize, CGSize(width: 3840, height: 2160))
            XCTAssertTrue(player.qualityMessage.contains("流畅"))
            let resets = player.engine!.resets
            for second in 5...20 { sample(player, at: Double(second), fps: 24) }
            XCTAssertEqual(player.engine!.resets, resets, "Do not oscillate back into the expensive shader")
        }
    }
    func testSustainedRenderDropsReduceLightweightAndNewEpisodeRetriesIt() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...15 { sample(player, at: Double(second), drops: Double(second * 3)) }
            XCTAssertEqual(player.engine!.appliedQuality, native)
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            try playFixture(player)
            XCTAssertEqual(player.engine!.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
            XCTAssertEqual(player.playbackProbe()["effectiveQualityPreset"].string, "tv-balanced")
        }
    }
    func testStartupPauseCacheSeekAndDecoderDropsDoNotTriggerReduction() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...4 { sample(player, at: Double(second), drops: Double(second * 20)) }
            for second in 5...10 { sample(player, at: Double(second), position: 4, drops: 200, paused: true) }
            for second in 11...16 { sample(player, at: Double(second), position: 4, drops: 300, buffering: true) }
            player.seek(by: 60)
            player.engine!.pendingEvents = [.restarted]
            for second in 17...25 { sample(player, at: Double(second), position: Double(second + 60), drops: 400) }
            for second in 26...40 { sample(player, at: Double(second), position: Double(second + 60), drops: Double(second * 30), decoderDrops: Double(second)) }
            XCTAssertEqual(player.engine!.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
        }
    }
    func testOneBadWindowCounterResetAndUnknownFPSKeepLightweight() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...8 { sample(player, at: Double(second), drops: second >= 7 ? 12 : 0, fps: 0) }
            for second in 9...20 { sample(player, at: Double(second), drops: 12, fps: 0) }
            for second in 21...35 { sample(player, at: Double(second), drops: 0, fps: 24) }
            XCTAssertEqual(player.engine!.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
        }
    }
    func testExplicitFullPresetIsNeverAutomaticallyChanged() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...20 { sample(player, at: Double(second), drops: Double(second * 30), fps: 60) }
            XCTAssertEqual(player.engine!.appliedQuality, desktop)
        }
    }
    func testFailedManualChangeAfterAutomaticReductionRestoresEffectiveNative() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...4 { sample(player, at: Double(second), fps: 60) }
            player.engine!.failingQualityValues = ["scale=ewa_lanczos"]
            player.selectQuality("tigerest-default")
            XCTAssertEqual(player.engine!.appliedQuality, native)
            XCTAssertEqual(player.qualityPreset, "tv-balanced")
            XCTAssertEqual(player.playbackProbe()["effectiveQualityPreset"].string, "native")
        }
    }
    func testAutomaticReductionFailureRestoresLightweightWithoutClaimingSuccess() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = player.engine!
            engine.pendingEvents = [.loaded]
            engine.failResetCalls = [engine.resets + 1]
            for second in 0...20 { sample(player, at: Double(second), fps: 60) }
            XCTAssertEqual(engine.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
            XCTAssertEqual(player.playbackProbe()["effectiveQualityPreset"].string, "tv-balanced")
            XCTAssertTrue(player.qualityMessage.contains("未能"))
            XCTAssertFalse(engine.closed)
        }
    }
    func testFailedAutomaticReductionAndRestoreStopPlayback() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = player.engine!
            engine.pendingEvents = [.loaded]
            engine.failQuality = true
            sample(player, at: 0, fps: 60)
            sample(player, at: 1, fps: 60)
            XCTAssertTrue(engine.closed)
            XCTAssertFalse(player.active)
            XCTAssertNotNil(player.error)
            XCTAssertFalse(player.qualityMessage.contains("已降低"))
        }
    }
    func testSingleHighFPSReadingAfterSeekDoesNotReduceQuality() throws {
        try withPreference("tv-balanced") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            player.engine!.pendingEvents = [.loaded]
            for second in 0...10 { sample(player, at: Double(second)) }
            player.seek(by: 60)
            player.engine!.pendingEvents = [.restarted]
            sample(player, at: 11, position: 71, drops: 100, fps: 90)
            for second in 12...25 { sample(player, at: Double(second), position: Double(second + 60), drops: 100) }
            XCTAssertEqual(player.engine!.appliedQuality["glsl-shaders"], "/app/shaders/ravu_lite_ar_r3.glsl")
        }
    }
    func testUnknownStoredPreferenceUsesNative() throws {
        try withPreference("obsolete-preset") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            XCTAssertEqual(player.qualityPreset, "native")
            XCTAssertEqual(player.engine?.appliedQuality, native)
        }
    }
    func testExplicitDesktopPreferenceRetainsEveryOptionAndAllThreeShaders() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: [])
            XCTAssertEqual(player.qualityPreset, "tigerest-default")
            try playFixture(player); defer { player.stop() }
            XCTAssertEqual(player.engine?.appliedQuality, desktop)
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tigerest-default")
        }
    }
    func testDesktopNativeRoundTripRestoresCompleteNativeBaseline() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = try XCTUnwrap(player.engine)
            player.selectQuality("native")
            XCTAssertEqual(engine.appliedQuality, native)
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "native")
            player.selectQuality("tigerest-default")
            XCTAssertEqual(engine.appliedQuality, desktop)
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tigerest-default")
            player.selectQuality("native")
            XCTAssertEqual(engine.appliedQuality, native)
        }
    }
    func testStartupDesktopFailureAppliesActualNativeBeforeLoad() throws {
        try withPreference("tigerest-default") {
            MPVEngine.failingNewQualityValues = ["scale=ewa_lanczos"]
            defer { MPVEngine.failingNewQualityValues = [] }
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            XCTAssertEqual(player.qualityPreset, "native")
            XCTAssertEqual(player.engine?.appliedQuality, native)
            XCTAssertEqual(player.engine?.actions.last, "loadfile")
            XCTAssertTrue(player.qualityMessage.contains("原生"))
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "tigerest-default")
        }
    }
    func testNativeStartupFailureDoesNotStartWithFalseNativeLabel() throws {
        try withPreference("native") {
            MPVEngine.failNewQuality = true
            defer { MPVEngine.failNewQuality = false }
            let player = TVPlaybackController(arguments: [])
            XCTAssertThrowsError(try playFixture(player))
            XCTAssertFalse(player.active)
            XCTAssertNil(player.engine)
        }
    }
    func testFailedDesktopSelectionRestoresAllNativeSettings() throws {
        try withPreference("native") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = try XCTUnwrap(player.engine)
            engine.failingQualityValues = ["scale=ewa_lanczos"]
            player.selectQuality("tigerest-default")
            XCTAssertEqual(player.qualityPreset, "native")
            XCTAssertEqual(engine.appliedQuality, native)
            XCTAssertTrue(player.qualityMessage.contains("已恢复"))
            XCTAssertEqual(UserDefaults.standard.string(forKey: "tv.qualityPreset"), "native")
        }
    }
    func testFailedDesktopRestoreFallsBackToActualNative() throws {
        try withPreference("tigerest-default") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player); defer { player.stop() }
            let engine = try XCTUnwrap(player.engine)
            engine.failResetCalls = [engine.resets + 1]
            engine.failingQualityValues = ["scale=ewa_lanczos"]
            player.selectQuality("native")
            XCTAssertEqual(player.qualityPreset, "native")
            XCTAssertEqual(engine.appliedQuality, native)
            XCTAssertFalse(engine.closed)
            XCTAssertTrue(player.qualityMessage.contains("已切换原生"))
        }
    }
    func testFailedNativeRecoveryStopsRatherThanClaimingSuccess() throws {
        try withPreference("native") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player)
            let engine = try XCTUnwrap(player.engine)
            engine.failQuality = true
            player.selectQuality("tigerest-default")
            XCTAssertTrue(engine.closed)
            XCTAssertFalse(player.active)
            XCTAssertNotNil(player.error)
            XCTAssertFalse(player.qualityMessage.contains("已恢复"))
        }
    }
    func testProbeContainsPerformanceEvidenceWithoutMediaOrPaths() throws {
        let player = TVPlaybackController(arguments: ["--tv-playback-probe"]), engine = try MPVEngine()
        engine.properties = [
            "video-params/w": .string("3840"), "video-params/h": .string("2160"), "video-codec": .string("hevc"),
            "frame-drop-count": .string("2"), "decoder-frame-drop-count": .string("0"),
            "path": .string("https://secret.example/movie?token=credential"), "media-title": .string("SECRET TITLE"),
            "glsl-shaders": .array([.string("/app/shaders/ravu.glsl")]),
            "vo-passes": .object(["fresh": .array([
                .object(["desc": .string("[KrigBilateral] Upscaling UV")]),
                .object(["desc": .string("https://secret.example/shader?token=credential /private/app/shader")])
            ])])
        ]
        player.engine = engine
        player.surface.metal.drawableSize = CGSize(width: 3840, height: 2160)
        let probe = player.playbackProbe()
        XCTAssertEqual(probe["videoParams"]["width"].number, 3840)
        XCTAssertEqual(probe["frame-drop-count"].number, 2)
        XCTAssertEqual(probe["cache"]["percent"], .null)
        XCTAssertEqual(probe["variant"], .null)
        XCTAssertEqual(probe["glsl-shaders"].array, [.string("ravu.glsl")])
        XCTAssertEqual(probe["vo-passes"]["fresh"].array?.first, .string("[KrigBilateral] Upscaling UV"))
        let encoded = String(decoding: try JSONEncoder().encode(probe), as: UTF8.self)
        for secret in ["secret.example", "credential", "SECRET TITLE", "/private", "/app"] { XCTAssertFalse(encoded.contains(secret)) }
    }
    func testEpisodeReplacementClosesOldEngineAndDiscardsPendingSubtitles() throws {
        let player = TVPlaybackController(arguments: [])
        let session = EmbySession(serverURL: "https://fixture.example", userID: "user", accessToken: "fixture", deviceID: "device")
        let client = try EmbyClient(session: session)
        let subtitle = EmbySubtitleTrack(index: 5, externalURL: URL(string: "https://fixture.example/first.srt"), title: "旧集字幕", isExternal: true)
        let first = EmbyPlayback(url: URL(fileURLWithPath: "/tmp/first.mp4"), headers: [:],
            item: .object(["Name": .string("第一集"), "ParentIndexNumber": .number(1), "IndexNumber": .number(1)]),
            mediaSourceID: "first", playSessionID: "first", startSeconds: 0, subtitleTracks: [subtitle])
        try player.play(first, client: client)
        let oldEngine = try XCTUnwrap(player.engine), oldGeneration = player.playbackGeneration, oldDanmakuEpoch = player.danmakuEpoch
        player.subtitles.fileLoaded()
        let stale = try XCTUnwrap(player.subtitles.options.first)
        player.subtitles.select(stale)
        XCTAssertTrue(player.subtitles.isLoading)
        let next = EmbyPlayback(url: URL(fileURLWithPath: "/tmp/second.mp4"), headers: [:],
            item: .object(["Name": .string("第二集"), "ParentIndexNumber": .number(1), "IndexNumber": .number(2)]),
            mediaSourceID: "next", playSessionID: "next", startSeconds: 0)
        var activeChanges: [Bool] = []
        let observation = player.$active.dropFirst().sink { activeChanges.append($0) }
        defer { observation.cancel() }
        try player.play(next, client: client)
        defer { player.stop() }
        let newEngine = try XCTUnwrap(player.engine)
        XCTAssertTrue(oldEngine.closed)
        XCTAssertFalse(newEngine === oldEngine)
        XCTAssertNotEqual(player.playbackGeneration, oldGeneration)
        XCTAssertGreaterThan(player.danmakuEpoch, oldDanmakuEpoch)
        XCTAssertEqual(player.title, "S01E02 · 第二集")
        XCTAssertTrue(player.active)
        XCTAssertFalse(activeChanges.contains(false), "Replacing an episode must keep the full-screen player presented")
        XCTAssertFalse(player.subtitles.isReady)
        XCTAssertFalse(player.subtitles.isLoading)
        XCTAssertTrue(player.subtitles.options.isEmpty)
        player.subtitles.fileLoaded(); player.subtitles.select(stale); player.subtitles.update()
        XCTAssertEqual(newEngine.string("sid"), "no")
        XCTAssertFalse(newEngine.commands.contains { $0.first == "sub-add" })
    }
    func testExplicitStopInvalidatesPendingEpisodeGeneration() throws {
        let player = TVPlaybackController(arguments: [])
        try playFixture(player)
        let requestGeneration = player.playbackGeneration
        player.stop()
        XCTAssertNotEqual(player.playbackGeneration, requestGeneration)
        XCTAssertFalse(player.active)
        XCTAssertNil(player.engine)
        XCTAssertFalse(player.subtitles.isReady)
    }
    func testFailedEpisodeReplacementDoesNotLeaveAnEmptyPlayerPresented() throws {
        try withPreference("native") {
            let player = TVPlaybackController(arguments: [])
            try playFixture(player)
            let oldEngine = try XCTUnwrap(player.engine)
            MPVEngine.failNewQuality = true
            defer { MPVEngine.failNewQuality = false }
            XCTAssertThrowsError(try playFixture(player))
            XCTAssertTrue(oldEngine.closed)
            XCTAssertFalse(player.active)
            XCTAssertNil(player.engine)
            XCTAssertFalse(player.subtitles.isReady)
        }
    }
}
