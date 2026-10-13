import XCTest
final class WebHostTests: XCTestCase {
    @MainActor func testOnboardingAndOfflineEntryAreAvailableWithoutNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()
        XCTAssertTrue(app.textFields["服务器地址"].waitForExistence(timeout: 10))
        app.buttons["离线媒体"].tap()
        XCTAssertTrue(app.staticTexts["尚无离线媒体"].waitForExistence(timeout: 5))
    }
}
