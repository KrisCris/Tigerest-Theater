import XCTest
import UIKit
final class WebHostTests: XCTestCase {
    @MainActor func testOnboardingAndOfflineEntryAreAvailableWithoutNetwork() {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]
        app.launch()
        XCTAssertTrue(app.buttons["连接大河李斯特专属 EMBY 服务器"].waitForExistence(timeout:10))
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        XCTAssertTrue(app.textFields["服务器地址"].waitForExistence(timeout: 10))
        app.buttons["离线媒体"].tap()
        XCTAssertTrue(app.staticTexts["尚无离线媒体"].waitForExistence(timeout: 5))
    }
}
extension WebHostTests {
    @MainActor func testVolumeAndMuteSurvivePlayerReplacement() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]; app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field = app.textFields["服务器地址"]; field.tap(); field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout: 20))
        app.buttons["验证音量保留"].tap()
        let result = app.staticTexts.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "音量保留校验通过", "音量保留失败")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        XCTAssertEqual(result.label, "音量保留校验通过")
    }

    @MainActor func testControlledBridgePlaybackAndDownload() {
        let app=XCUIApplication();app.launchArguments=["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"];app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
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

extension WebHostTests {
    @MainActor func testQueueSelectionUsesWebPlaylistId() {
        let app = openQueueFixture()
        XCTAssertTrue(app.staticTexts["第一项"].waitForExistence(timeout: 10))
        app.buttons["下一集"].tap()
        XCTAssertTrue(app.staticTexts["重复媒体第二项"].waitForExistence(timeout: 10), "换集须通过共享 inputPlugin 真正加载另一播放列表项")
        app.buttons["上一集"].tap()
        XCTAssertTrue(app.staticTexts["第一项"].waitForExistence(timeout: 10))
        app.buttons["选集"].tap()
        XCTAssertTrue(app.buttons["S01E01 · 第一项"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["S01E02 · 重复媒体第二项"].exists)
        app.buttons["S02E03 · 跨季第三项"].tap()
        XCTAssertTrue(app.staticTexts["跨季第三项"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["下一集"].isEnabled, "末项不能继续向后跳转")
        app.buttons["上一集"].tap()
        XCTAssertTrue(app.staticTexts["重复媒体第二项"].waitForExistence(timeout: 10))
        app.buttons["上一集"].tap()
        XCTAssertTrue(app.staticTexts["第一项"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["上一集"].isEnabled, "首项不能继续向前跳转")
    }

    @MainActor func testEpisodeMenuWorksDuringPlayback() {
        let app = openQueueFixture()
        XCTAssertTrue(app.staticTexts["第一项"].waitForExistence(timeout: 10))
        app.buttons["播放"].tap()
        app.buttons["选集"].tap()
        let episode = app.buttons["S01E02 · 重复媒体第二项"]
        XCTAssertTrue(episode.waitForExistence(timeout: 2))
        // Deliberately keep choosing beyond the OSD's 3.5-second hide deadline.
        Thread.sleep(forTimeInterval: 4)
        XCTAssertTrue(episode.exists, "选择期间不能被控制栏自动隐藏收掉")
        XCTAssertFalse(statusBarContent.exists, "选集浮层也不能露出系统顶栏")
        episode.tap()
        XCTAssertTrue(app.staticTexts["重复媒体第二项"].waitForExistence(timeout: 10))
    }

    @MainActor func testPlaybackHidesStatusBarUntilExit() {
        let app = openQueueFixture()
        XCTAssertTrue(app.staticTexts["第一项"].waitForExistence(timeout: 10))
        XCTAssertTrue(statusBarContent.waitForNonExistence(timeout: 5), "暂停及 OSD 显示时也应隐藏系统顶栏")
        app.buttons["播放"].tap()
        XCTAssertTrue(statusBarContent.waitForNonExistence(timeout: 5))
        app.buttons["退出播放"].tap()
        XCTAssertTrue(statusBarContent.waitForExistence(timeout: 5), "退出播放器后应恢复系统顶栏")
    }

    // iPadOS retains empty status-bar containers in SpringBoard even when hidden.
    // Assert its actual clock/battery content rather than the container's existence.
    @MainActor private var statusBarContent: XCUIElement {
        XCUIApplication(bundleIdentifier: "com.apple.springboard").statusBars
            .descendants(matching: .any).matching(NSPredicate(format: "label != ''")).firstMatch
    }

    @MainActor private func openQueueFixture() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]; app.launch()
        XCTAssertTrue(statusBarContent.waitForExistence(timeout: 5))
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field = app.textFields["服务器地址"]; field.tap(); field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout: 20))
        app.buttons["验证选集"].tap()
        return app
    }

    @MainActor func testSubtitleSettingsReachPlayerAndReset() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]; app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field = app.textFields["服务器地址"]; field.tap(); field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout: 20))
        app.buttons["验证字幕设置"].tap()
        let result = app.staticTexts.matching(NSPredicate(format: "label == %@ OR label BEGINSWITH %@", "字幕设置校验通过", "字幕设置失败")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 15))
        XCTAssertEqual(result.label, "字幕设置校验通过")
    }
}


extension WebHostTests {
    @MainActor private func openGestureFixture() -> XCUIApplication {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]; app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field = app.textFields["服务器地址"]; field.tap(); field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout: 20))
        app.buttons["验证播放手势"].tap()
        XCTAssertTrue(app.buttons["锁定"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["playbackTime"].wait(for: \.label, toEqual: "0:00:00 / 0:00:12", timeout: 3))
        return app
    }
    @MainActor func testTouchLockRequiresLongPressToUnlock() {
        let app = openGestureFixture()
        app.buttons["锁定"].tap()
        let unlock = app.buttons["长按解除防误触锁"]
        XCTAssertTrue(unlock.waitForExistence(timeout: 2), app.debugDescription)
        unlock.tap()
        XCTAssertTrue(unlock.exists, "短按不能解除防误触锁")
        let video = app.otherElements["playerVideo"]
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).doubleTap()
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.3)).press(forDuration: 0.1, thenDragTo: video.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.3)))
        XCTAssertTrue(unlock.waitForNonExistence(timeout: 5), "锁定提示应自动隐藏，即使暂停也不能永久遮挡")
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3)).tap()
        XCTAssertTrue(unlock.waitForExistence(timeout: 2), "锁定时轻点画面应唤回解锁按钮")
        unlock.press(forDuration: 0.8)
        XCTAssertTrue(app.buttons["锁定"].waitForExistence(timeout: 3))
        XCTAssertEqual(app.staticTexts["playbackTime"].label, "0:00:00 / 0:00:12")
    }
    @MainActor func testHorizontalSeekAndBrightnessGestureFeedback() {
        let app = openGestureFixture()
        let video = app.otherElements["playerVideo"]
        XCTAssertTrue(video.exists)
        let start = video.coordinate(withNormalizedOffset: CGVector(dx: 0.4, dy: 0.32))
        let end = video.coordinate(withNormalizedOffset: CGVector(dx: 0.65, dy: 0.32))
        start.press(forDuration: 0.1, thenDragTo: end)
        let position = app.staticTexts["playbackTime"]
        XCTAssertTrue(position.wait(for: \.label, toEqual: "0:00:02 / 0:00:12", timeout: 3) || position.label == "0:00:03 / 0:00:12", position.label)
        let brightStart = video.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.4))
        brightStart.press(forDuration: 0.1, thenDragTo: video.coordinate(withNormalizedOffset: CGVector(dx: 0.2, dy: 0.2)))
        XCTAssertTrue(app.staticTexts["playerGestureFeedback"].label.hasPrefix("亮度"))
        app.buttons["退出播放"].tap()
        XCTAssertTrue(app.buttons["验证播放手势"].exists)
    }
    @MainActor func testStationaryHoldRestoresPlaybackSpeed() {
        let app = openGestureFixture()
        app.buttons["播放"].tap()
        let video = app.otherElements["playerVideo"]
        video.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.32)).press(forDuration: 0.9)
        app.buttons["退出播放"].tap()
        XCTAssertTrue(app.staticTexts["长按倍速及恢复通过"].waitForExistence(timeout: 4))
    }
}

extension WebHostTests {
    @MainActor func testVideoTapAndDoubleTapControlPlayback() {
        let app = openGestureFixture()
        let point = app.otherElements["playerVideo"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        point.doubleTap()
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout: 2))
        point.doubleTap()
        XCTAssertTrue(app.buttons["播放"].waitForExistence(timeout: 2))
        point.tap()
        XCTAssertTrue(app.buttons["锁定"].waitForNonExistence(timeout: 2))
        point.tap()
        XCTAssertTrue(app.buttons["锁定"].waitForExistence(timeout: 2))
    }
}

extension WebHostTests {
    @MainActor func testBundledArtSettingsDanmakuAndReturnTransition() {
        let app = XCUIApplication(); app.launchArguments = ["--ui-testing", "-TigerestPlaybackGesturesSeen", "YES"]; app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field = app.textFields["服务器地址"]; field.tap(); field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout: 20))
        for (button, result) in [("验证首页资源", "四张首页图片加载通过"), ("验证主设置画质", "主设置画质校验通过"), ("验证返回转场", "返回转场全分辨率与清理通过")] {
            app.buttons[button].tap()
            XCTAssertTrue(app.staticTexts[result].waitForExistence(timeout: 15), app.debugDescription)
        }
        app.buttons["验证弹幕"].tap()
        XCTAssertTrue(app.staticTexts["danmakuStatus"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["danmakuStatus"].wait(for: \.label, toEqual: "已载入 3 条弹幕", timeout: 15), app.debugDescription)
        let screenshot = XCTAttachment(screenshot: app.screenshot()); screenshot.name = "danmaku-rendered"; screenshot.lifetime = .keepAlways; add(screenshot)
        XCTAssertFalse(app.buttons["画质"].exists)
        app.buttons["退出播放"].tap()
        XCTAssertTrue(app.staticTexts["弹幕匹配开关与偏移通过"].waitForExistence(timeout: 10), app.debugDescription)
    }
}

extension WebHostTests {
    @MainActor func testSpacePausesAfterOSDAutoHideWithoutReloading() {
        let app=XCUIApplication();app.launchArguments=["--ui-testing","-TigerestPlaybackGesturesSeen","YES"];app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field=app.textFields["服务器地址"];field.tap();field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout:20))
        app.buttons["验证实体键盘"].tap()
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout:8))
        XCTAssertTrue(app.buttons["暂停"].waitForNonExistence(timeout:6))
        app.typeKey(" ",modifierFlags:[])
        XCTAssertTrue(app.buttons["播放"].waitForExistence(timeout:2), "隐藏 OSD 后空格必须暂停")
        let position=app.staticTexts["playbackTime"].label
        XCTAssertFalse(position.hasPrefix("0:00:00"));XCTAssertFalse(position.hasPrefix("0:00:02"))
        app.buttons["弹幕"].tap()
        let search=app.textFields["搜索作品"];XCTAssertTrue(search.waitForExistence(timeout:3));search.tap();search.typeText("Blue Box")
        XCTAssertEqual(search.value as? String,"Blue Box","搜索框内空格必须作为文本输入")
        app.buttons["完成"].tap()
        XCTAssertTrue(app.buttons["播放"].waitForExistence(timeout:3))
        app.buttons["锁定"].tap()
        app.typeKey(" ",modifierFlags:[])
        let unlock=app.buttons["长按解除防误触锁"]
        XCTAssertTrue(unlock.waitForExistence(timeout:2));unlock.press(forDuration:0.8)
        XCTAssertTrue(app.buttons["播放"].waitForExistence(timeout:2),"锁定状态的空格不能改变播放")
        app.typeKey(" ",modifierFlags:[])
        XCTAssertTrue(app.buttons["暂停"].waitForExistence(timeout:2))
        app.buttons["退出播放"].tap()
        XCTAssertTrue(app.staticTexts["键盘播放次数 1"].waitForExistence(timeout:3), "空格不可穿透重新载入底层网页的剧集")
    }
}

extension WebHostTests {
    /// Real read-only GitHub check through WKWebView -> native bridge -> HTTP.
    @MainActor func testIPadUpdateEntryShowsPlatformStatusWithoutInstaller() {
        let app=XCUIApplication();app.launchArguments=["--ui-testing","-TigerestPlaybackGesturesSeen","YES"];app.launch()
        app.buttons["连接自建 Emby / Jellyfin 服务器"].tap()
        let field=app.textFields["服务器地址"];field.tap();field.typeText("http://127.0.0.1:18768/sub/")
        app.buttons["连接服务器"].tap()
        XCTAssertTrue(app.staticTexts["桥接校验通过"].waitForExistence(timeout:20))
        let entry=app.descendants(matching:.any).matching(NSPredicate(format:"label == %@ OR label BEGINSWITH %@","客户端更新","客户端有新版本")).firstMatch
        XCTAssertTrue(entry.waitForExistence(timeout:5),app.debugDescription);entry.tap()
        let result=app.staticTexts.matching(NSPredicate(format:"label == %@ OR label == %@ OR label == %@","iPad 版本发布情况","发现新版本","检查完成")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout:35),app.debugDescription)
        XCTAssertTrue(app.buttons["查看发布说明"].exists)
        XCTAssertFalse(app.buttons["立即更新"].exists);XCTAssertFalse(app.buttons["安装更新"].exists)
        let capture=XCTAttachment(screenshot:app.screenshot());capture.name="ipad-update-status";capture.lifetime = .keepAlways;add(capture)
        app.buttons["关闭"].tap()
    }
}
