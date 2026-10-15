import Foundation
import XCTest
import AppleCore
@testable import SharedDanmaku

@MainActor final class DanmakuHostTests: XCTestCase {
    private func fixture() throws -> FixtureHost {
        let root = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        return FixtureHost(directory: root)
    }
    private let item: JSONValue = .object(["Id": .string("episode-1"), "SeriesName": .string("作品"),
        "ParentIndexNumber": .number(1), "IndexNumber": .number(1), "Name": .string("开始")])
    private func settled(_ repository: DanmakuRepository) async throws {
        for _ in 0..<100 {
            if !repository.sources.isEmpty || !repository.status.contains("正在") { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Matching never settled")
    }
    func testSharedLookupPopulatesSourcesWithoutEmbyCredentials() async throws {
        let host = try fixture(), repo = DanmakuRepository(host: host)
        repo.autoMatch(item)
        try await settled(repo)
        XCTAssertEqual(repo.sources.first?.comments.first?.text, "来自共享匹配")
        XCTAssertEqual(host.paths, ["/api/tigerest/v1/danmaku"])
    }
    func testRateLimitedSharedLookupDoesNotFallThroughToCommentGET() async throws {
        let host = try fixture(); host.statusCode = 429
        let repo = DanmakuRepository(host: host)
        repo.autoMatch(item)
        try await settled(repo)
        XCTAssertTrue(repo.sources.isEmpty)
        XCTAssertEqual(host.paths, ["/api/tigerest/v1/danmaku"])
    }
    func testManualSelectionAndDelayPreserveProviderAndEpisodeIdentity() async throws {
        let host = try fixture(), repo = DanmakuRepository(host: host)
        let works = try await repo.search("作品")
        let episodes = try await repo.episodes(for: works[0])
        try await repo.select(episodes[0], work: works[0], share: false)
        XCTAssertEqual(repo.sources.first?.comments.first?.text, "手动选择")
        XCTAssertEqual(host.paths, ["/api/v2/search/anime", "/api/v2/bangumi/1", "/api/v2/comment/11"])
        let source = try XCTUnwrap(repo.sources.first)
        try repo.setSource(source.id, enabled: true, delay: 0.5)
        XCTAssertEqual(repo.allComments.first?.time, 1.5)
        repo.clear()
        do { try await repo.select(episodes[0], work: works[0], share: true); XCTFail("Stale selection accepted") }
        catch is CancellationError {}
        XCTAssertTrue(repo.sources.isEmpty)
    }
    func testTVPreferencesAndCachesAreIsolatedByServerAndUser() throws {
        let root = try fixture().directory
        func session(_ server: String, _ user: String) -> EmbySession {
            EmbySession(serverURL: server, userID: user, accessToken: "not-for-cache", deviceID: "fixture")
        }
        let first = TVDanmakuHost(session: session("https://one.example", "alice"), storageRoot: root)
        let second = TVDanmakuHost(session: session("https://one.example", "bob"), storageRoot: root)
        let third = TVDanmakuHost(session: session("https://two.example", "alice"), storageRoot: root)
        try first.setSetting("mpv", "enableDanmaku", .bool(false))
        XCTAssertNotEqual(first.directory, second.directory)
        XCTAssertNotEqual(first.directory, third.directory)
        XCTAssertEqual(second.setting("mpv", "enableDanmaku"), .bool(true))
        XCTAssertEqual(TVDanmakuHost(session: session("https://one.example", "alice"), storageRoot: root).setting("mpv", "enableDanmaku"), .bool(false))
        XCTAssertThrowsError(try first.setSetting("danmaku", "opacity", .number(2)))
        XCTAssertThrowsError(try first.setSetting("danmaku", "apiServer", .string("https://valid.example,garbage")))
        XCTAssertFalse(first.directory.path.contains("not-for-cache"))
        XCTAssertTrue(first.mappingHeaders.isEmpty)
    }
    func testExplicitSharedCorrectionUsesTrustedHeadersOnlyForManagedWrite() async throws {
        let host = try fixture()
        host.mappingHeaders = ["X-Emby-Token": "fixture-token", "X-Emby-Server-Id": "fixture-server", "X-Emby-User-Id": "fixture-user"]
        try host.setSetting("mpv", "enableDanmaku", .bool(false))
        let repo = DanmakuRepository(host: host)
        repo.autoMatch(item)
        let works = try await repo.search("作品"), episodes = try await repo.episodes(for: works[0])
        try await repo.select(episodes[0], work: works[0], share: true)
        XCTAssertEqual(repo.sources.first?.comments.first?.text, "来自共享匹配")
        XCTAssertEqual(host.authenticatedPaths, ["/api/tigerest/v1/danmaku"])
        XCTAssertFalse(host.paths.contains("/api/v2/comment/11"))
    }
}

@MainActor private final class FixtureHost: DanmakuHost {
    let directory: URL
    let serverHost: String? = "fixture.invalid"
    let cacheScope = "fixture"
    var mappingHeaders: [String: String] = [:]
    var paths: [String] = []
    var authenticatedPaths: [String] = []
    var statusCode = 200
    private var enabled = true
    init(directory: URL) { self.directory = directory }
    func setting(_ section: String, _ key: String) -> JSONValue { key == "enableDanmaku" ? .bool(enabled) : .null }
    func setSetting(_ section: String, _ key: String, _ value: JSONValue) throws { enabled = value.bool ?? true }
    func log(_ level: String, _ message: String) {}
    func emit(_ event: String, _ args: [JSONValue]) {}
    func data(_ request: URLRequest, limit: Int) async throws -> (Data, HTTPURLResponse) {
        let path = request.url!.path; paths.append(path)
        let body: String
        switch path {
        case "/api/tigerest/v1/danmaku":
            let requestBody = try JSONDecoder().decode(JSONValue.self, from: request.httpBody ?? Data())
            let origin = requestBody["selection"] == .null ? "shared" : "manual"
            body = #"{"success":true,"matched":true,"match":{"origin":"ORIGIN","episodeId":"11","episodeTitle":"开始"},"danmaku":{"comments":[{"p":"1,1,16777215","m":"来自共享匹配"}]}}"#.replacingOccurrences(of: "ORIGIN", with: origin)
        case "/api/v2/search/anime": body = #"{"animes":[{"bangumiId":"1","animeTitle":"作品"}]}"#
        case "/api/v2/bangumi/1": body = #"{"bangumi":{"episodes":[{"episodeId":"11","episodeTitle":"开始"}]}}"#
        case "/api/v2/comment/11": body = #"{"comments":[{"p":"1,1,16777215","m":"手动选择"}]}"#
        default: throw URLError(.badURL)
        }
        if let token = request.value(forHTTPHeaderField: "X-Emby-Token") {
            authenticatedPaths.append(path)
            XCTAssertEqual(token, "fixture-token")
            XCTAssertEqual(path, "/api/tigerest/v1/danmaku")
        }
        return (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: statusCode, httpVersion: nil, headerFields: ["Retry-After": "60"])!)
    }
}
