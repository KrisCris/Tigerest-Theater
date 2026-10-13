import XCTest
final class WebHostTests: XCTestCase {
    @MainActor func testOnboardingAndOfflineEntryAreAvailableWithoutNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.buttons["连接大河李斯特专属 EMBY 服务器"].waitForExistence(timeout:10))
        app.buttons["连接自建 EMBY 服务器"].tap()
        XCTAssertTrue(app.textFields["服务器地址"].waitForExistence(timeout: 10))
        app.buttons["离线媒体"].tap()
        XCTAssertTrue(app.staticTexts["尚无离线媒体"].waitForExistence(timeout: 5))
    }
}
extension WebHostTests {
    @MainActor func testControlledBridgePlaybackAndDownload() {
        let app=XCUIApplication();app.launchArguments=["--ui-testing"];app.launch()
        app.buttons["连接自建 EMBY 服务器"].tap()
        let field=app.textFields["服务器地址"]
        XCTAssertTrue(field.waitForExistence(timeout:10));field.tap();field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout:20),app.debugDescription)
        XCTAssertFalse(app.buttons["服务器"].exists)
        XCTAssertFalse(app.buttons["配置"].exists)
        XCTAssertFalse(app.buttons["重新载入"].exists)
        app.buttons["验证播放循环"].tap()
        let playbackResult = app.staticTexts.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "20 次播放和定位通过", "播放失败")).firstMatch
        XCTAssertTrue(playbackResult.waitForExistence(timeout:150))
        XCTAssertEqual(playbackResult.label, "20 次播放和定位通过")
        app.buttons["验证离线下载"].tap()
        XCTAssertTrue(app.staticTexts["下载完成并校验通过"].waitForExistence(timeout:40),app.debugDescription)
        app.buttons["打开离线媒体"].tap()
        XCTAssertTrue(app.staticTexts["离线夹具"].waitForExistence(timeout:5))
    }
}
