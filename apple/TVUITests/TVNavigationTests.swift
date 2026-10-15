import XCTest

@MainActor
final class TVNavigationTests: XCTestCase {
    func testFixtureBrowseSeasonsAndEpisodes() throws {
        let app = launchFixture()
        try select("tv.item.fixture.series", in: app)
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

    func testFixturePlaybackPauseAndBack() throws {
        let app = launchFixture(media: true)
        try select("tv.item.fixture.movies", in: app)
        try select("tv.item.fixture.movie", in: app)
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

    private func launchFixture(media: Bool = false) -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--tv-fixture"] + (media ? ["--tv-fixture-media", "bundled"] : [])
        app.launch()
        XCTAssertTrue(app.buttons["tv.item.fixture.movies"].waitForExistence(timeout: 15))
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
