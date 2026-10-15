import XCTest

@MainActor
final class TVNavigationTests: XCTestCase {
    func testFixtureBrowseSeasonsAndEpisodes() throws {
        let app = launchFixture()
        try select("tv.library.fixture.series", in: app)
        try select("tv.item.fixture.show", in: app)
        try select("tv.item.fixture.season", in: app)
        let episode = app.buttons["tv.item.fixture.episode.1"]
        XCTAssertTrue(episode.waitForExistence(timeout: 5))
        XCTAssertTrue(episode.label.contains("S01E01"))
        try select("tv.item.fixture.episode.1", in: app)
        XCTAssertTrue(app.buttons["tv.resume"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tv.play"].waitForExistence(timeout: 5))
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(episode.waitForExistence(timeout: 5))
        expect("Returning from details restores focus to the selected episode") { episode.hasFocus }
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.item.fixture.season"].waitForExistence(timeout: 5))
    }

    func testHomePreviewAndQualityPanel() throws {
        let app = launchFixture()
        let hero = app.buttons["tv.home.hero"]
        XCTAssertTrue(hero.waitForExistence(timeout: 5), app.debugDescription)
        XCTAssertTrue(hero.label.contains("星海远航"))
        XCUIRemote.shared.press(.down)
        expect("Moving focus previews the next library without navigating") {
            app.buttons["tv.library.fixture.series"].hasFocus && hero.label.contains("星海纪事")
        }
        XCTAssertFalse(app.buttons["tv.back"].exists)
        try select("tv.home.hero", in: app)
        XCTAssertTrue(app.buttons["tv.item.fixture.season"].waitForExistence(timeout: 5))
        XCUIRemote.shared.press(.menu)
        let poster = app.buttons["tv.item.fixture.show"]
        XCTAssertTrue(poster.waitForExistence(timeout: 5), app.debugDescription)
        expect("Returning from a home recommendation restores the library poster wall") { poster.hasFocus }
        XCTAssertFalse(hero.exists)
        try select("tv.quality", in: app)
        XCTAssertTrue(app.buttons["tv.quality.default"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tv.quality.native"].exists)
        try select("tv.quality.balanced", in: app)
        XCTAssertTrue(app.staticTexts["已选择轻量增强"].exists)
        try select("tv.quality.native", in: app)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(poster.waitForExistence(timeout: 5), app.debugDescription)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(hero.waitForExistence(timeout: 5), app.debugDescription)
    }

    func testFixturePlaybackPauseAndBack() throws {
        let app = launchFixture(media: true)
        try select("tv.library.fixture.movies", in: app)
        try select("tv.item.fixture.movie", in: app)
        try select("tv.quality", in: app)
        try select("tv.quality.balanced", in: app)
        XCUIRemote.shared.press(.menu)
        try select("tv.play", in: app)
        XCTAssertTrue(app.buttons["tv.player.pause"].waitForExistence(timeout: 20))
        expect("The local fixture must actually advance through MPV", timeout: 15) { self.position(in: app) >= 1 }
        XCUIRemote.shared.press(.playPause)
        expect("The remote pauses the player") { app.buttons["tv.player.pause"].label.contains("播放") }
        let pausedPosition = position(in: app)
        let advancesWhilePaused = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.position(in: app) > pausedPosition + 1
        }, object: nil)
        advancesWhilePaused.isInverted = true
        wait(for: [advancesWhilePaused], timeout: 2.5)
        XCUIRemote.shared.press(.playPause)
        expect("The remote resumes actual playback", timeout: 10) { self.position(in: app) > pausedPosition + 1 }
        let positionBeforeExit = position(in: app)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.play"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["tv.player.pause"].exists)
        let resume = app.buttons["tv.resume"]
        XCTAssertTrue(resume.waitForExistence(timeout: 5), "Stopping playback must immediately expose the updated resume position")
        let resumeClock = resume.label.components(separatedBy: "·").last?.trimmingCharacters(in: .whitespaces) ?? ""
        XCTAssertGreaterThanOrEqual(clockSeconds(resumeClock), positionBeforeExit)
    }

    func testFixtureLogoutExposesBothServerChoices() throws {
        let app = launchFixture()
        try select("tv.logout", in: app)
        try select("tv.mode.dedicated", in: app)
        XCTAssertTrue(app.textFields["tv.login.username"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.secureTextFields["tv.login.password"].exists)
        XCTAssertFalse(app.textFields["tv.login.server"].exists)
        XCUIRemote.shared.press(.menu)
        try select("tv.mode.selfHosted", in: app)
        XCTAssertTrue(app.textFields["tv.login.server"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tv.login.submit"].exists)
    }

    func testEmbeddedSubtitleSelectionAndOff() throws {
        let app = launchFixture(media: true)
        try select("tv.library.fixture.movies", in: app)
        try select("tv.item.fixture.movie", in: app)
        try select("tv.play", in: app)
        XCTAssertTrue(app.buttons["tv.player.pause"].waitForExistence(timeout: 20))
        expect("Subtitle fixture video advances", timeout: 15) { self.position(in: app) >= 1 }
        XCUIRemote.shared.press(.playPause)
        expect("Pause keeps subtitle controls visible") { app.buttons["tv.player.pause"].label.contains("播放") }
        try select("tv.player.subtitles", in: app)
        let track = app.buttons["tv.subtitles.track.1"]
        XCTAssertTrue(track.waitForExistence(timeout: 8), "MPV must expose the real embedded subtitle even without Emby metadata")
        try select("tv.subtitles.track.1", in: app)
        expect("The actual MPV subtitle track is selected") { (track.value as? String) == "已选择" }
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.player.subtitles"].waitForExistence(timeout: 5))
        XCUIRemote.shared.press(.playPause)
        XCTAssertTrue(app.buttons["tv.player.reveal"].waitForExistence(timeout: 10), "Hide the OSD so it cannot cover the rendered subtitle")
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Chinese embedded subtitle rendering"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCUIRemote.shared.press(.playPause)
        expect("Pause reveals subtitle controls again") { app.buttons["tv.player.pause"].label.contains("播放") }
        try select("tv.player.subtitles", in: app)
        try select("tv.subtitles.off", in: app)
        expect("Subtitles can be disabled without stopping video") {
            (app.buttons["tv.subtitles.off"].value as? String) == "已选择"
        }
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.player.pause"].waitForExistence(timeout: 5))
    }

    func testPlayerEpisodeNavigationKeepsPlaybackAndReturnContext() throws {
        let app = launchFixture(media: true)
        try select("tv.library.fixture.series", in: app)
        try select("tv.item.fixture.show", in: app)
        try select("tv.item.fixture.season", in: app)
        try select("tv.item.fixture.episode.1", in: app)
        try select("tv.play", in: app)
        expect("First episode starts with a real MPV clock", timeout: 20) { self.position(in: app) >= 1 }
        XCUIRemote.shared.press(.playPause)
        expect("Pause holds the controls for the episode action") { app.buttons["tv.player.pause"].label.contains("播放") }
        XCTAssertFalse(app.buttons["tv.player.previous"].isEnabled)
        try select("tv.player.next", in: app)
        expect("Next episode changes the actual playback title", timeout: 15) {
            app.staticTexts["tv.player.title"].label.contains("S01E02")
        }
        expect("The new episode actually advances", timeout: 15) { self.position(in: app) >= 1 }
        XCUIRemote.shared.press(.playPause)
        expect("Pause second episode") { app.buttons["tv.player.pause"].label.contains("播放") }
        XCTAssertFalse(app.buttons["tv.player.next"].isEnabled)
        try select("tv.player.episodes", in: app)
        try select("tv.episodes.item.fixture.episode.1", in: app)
        expect("The episode picker switches back to S01E01", timeout: 15) {
            app.staticTexts["tv.player.title"].label.contains("S01E01")
        }
        XCTAssertTrue(app.buttons["tv.player.pause"].exists)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.play"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["tv.player.pause"].exists)
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.item.fixture.episode.1"].waitForExistence(timeout: 5))
    }

    func testEpisodeDetailsOfferOtherSeasonsWithoutGrowingBackStack() throws {
        let app = launchFixture()
        try select("tv.library.fixture.series", in: app)
        try select("tv.item.fixture.show", in: app)
        try select("tv.item.fixture.season", in: app)
        try select("tv.item.fixture.episode.1", in: app)
        XCTAssertTrue(app.buttons["tv.play"].waitForExistence(timeout: 5))
        try select("tv.detail.season.fixture.season.2", in: app)
        let nextSeason = app.buttons["tv.item.fixture.episode.s2.2"]
        XCTAssertTrue(nextSeason.waitForExistence(timeout: 5))
        XCTAssertTrue(nextSeason.label.contains("S02E02"))
        try select("tv.item.fixture.episode.s2.2", in: app)
        expect("Choosing a sibling updates the selected episode in place") { (nextSeason.value as? String) == "当前集" }
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Episode details and season selection"
        attachment.lifetime = .keepAlways
        add(attachment)
        XCUIRemote.shared.press(.menu)
        let original = app.buttons["tv.item.fixture.episode.1"]
        XCTAssertTrue(original.waitForExistence(timeout: 5), app.debugDescription)
        expect("One back restores the original episode list and focus") { original.hasFocus }
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.item.fixture.season"].waitForExistence(timeout: 5))
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.item.fixture.show"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["tv.home.hero"].exists)
    }

    #if TV_PERFORMANCE_TEST
    /// Opt-in physical-device load check; never reads Keychain or reports progress.
    func testLightweightSustainedPlayback() throws {
        let app = launchFixture(media: true, probe: true)
        try select("tv.library.fixture.movies", in: app)
        try select("tv.item.fixture.movie", in: app)
        try select("tv.quality", in: app)
        try select("tv.quality.balanced", in: app)
        XCUIRemote.shared.press(.menu)
        try select("tv.play", in: app)
        expect("Fixture starts through the actual TV renderer", timeout: 20) { self.position(in: app) >= 1 }
        for checkpoint in 1...6 {
            Thread.sleep(forTimeInterval: 30)
            XCUIRemote.shared.press(.down)
            XCTAssertTrue(app.buttons["tv.player.pause"].waitForExistence(timeout: 5))
            XCTAssertGreaterThan(position(in: app), checkpoint * 20)
            print("TV lightweight playback checkpoint \(checkpoint) / 6")
            if checkpoint == 3 {
                XCUIRemote.shared.press(.playPause)
                Thread.sleep(forTimeInterval: 2)
                XCUIRemote.shared.press(.playPause)
                try select("tv.player.forward", in: app)
            }
        }
        // A prior physical run disconnected during capture. Keep this timing
        // probe free of captures; visual verification is a separate check.
        XCUIRemote.shared.press(.menu)
        XCTAssertTrue(app.buttons["tv.play"].waitForExistence(timeout: 5))
    }
    #endif

    private func launchFixture(media: Bool = false, probe: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--tv-fixture"] + (media ? ["--tv-fixture-media", "bundled"] : []) + (probe ? ["--tv-playback-probe"] : [])
        app.launch()
        XCTAssertTrue(app.buttons["tv.library.fixture.movies"].waitForExistence(timeout: 15))
        return app
    }

    /// Exercise the focus engine and remote, including scrolling to offscreen rows.
    private func select(_ identifier: String, in app: XCUIApplication) throws {
        let target = app.buttons[identifier]
        XCTAssertTrue(target.waitForExistence(timeout: 8), "Missing button: \(identifier)")
        for _ in 0..<24 {
            if target.hasFocus {
                XCUIRemote.shared.press(.select)
                return
            }
            let current = app.buttons.allElementsBoundByIndex.first { $0.hasFocus }
            guard let current else {
                XCUIRemote.shared.press(.down)
                continue
            }
            let targetFrame = target.frame
            let currentFrame = current.frame
            let vertical = targetFrame.midY - currentFrame.midY
            let horizontal = targetFrame.midX - currentFrame.midX
            let direction: XCUIRemote.Button
            if abs(vertical) > max(50, min(currentFrame.height, targetFrame.height) * 0.6) {
                direction = vertical > 0 ? .down : .up
            } else {
                direction = horizontal > 0 ? .right : .left
            }
            XCUIRemote.shared.press(direction)
        }
        XCTFail("Remote could not focus \(identifier). UI: \(app.debugDescription)")
        throw NavigationFailure.focusUnavailable
    }

    private func position(in app: XCUIApplication) -> Int {
        let element = app.staticTexts["tv.player.position"]
        guard element.exists, let elapsed = element.label.components(separatedBy: " / ").first else { return -1 }
        return clockSeconds(elapsed)
    }

    private func clockSeconds(_ clock: String) -> Int {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return -1 }
        return parts.reduce(0) { $0 * 60 + $1 }
    }

    private func expect(_ description: String, timeout: TimeInterval = 5, condition: @escaping () -> Bool) {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        expectation.expectationDescription = description
        wait(for: [expectation], timeout: timeout)
    }

    private enum NavigationFailure: Error { case focusUnavailable }
}
