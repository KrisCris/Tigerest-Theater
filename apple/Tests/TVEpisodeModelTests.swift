import AppleCore
import Foundation
import XCTest
@testable import TVHomeModel

@MainActor final class TVEpisodeModelTests: XCTestCase {
    private func model() async -> TVAppModel {
        _ = URLProtocol.registerClass(EpisodeFixtureProtocol.self)
        EpisodeFixtureProtocol.reset()
        let session = EmbySession(serverURL: "https://episode-fixture.invalid/proxy", userID: "user", accessToken: "fixture", deviceID: "fixture", serverID: "fixture")
        let model = TVAppModel(fixtureMode: false, store: TVSessionStore(initialSession: session))
        await model.start()
        addTeardownBlock { URLProtocol.unregisterClass(EpisodeFixtureProtocol.self) }
        return model
    }
    func testDeepEpisodeLoadsBoundedContextAndCorrectAdjacentEpisodes() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(500))
        XCTAssertEqual(model.episodeSeasons.count, 2)
        XCTAssertEqual(model.episodeSeasonID, "season1")
        XCTAssertEqual(model.currentEpisodeID, "ep500")
        XCTAssertTrue(model.canPlayPreviousEpisode && model.canPlayNextEpisode)
        XCTAssertTrue(model.episodeQueue.contains { TVMedia.id($0) == "ep499" })
        XCTAssertTrue(model.episodeHasMore)
        XCTAssertEqual(EpisodeFixtureProtocol.episodeOffsets, [0], "Never scan hundreds of earlier episodes to find the current one")
        await model.playPreviousEpisode()
        XCTAssertEqual(model.player.played.last?.item["Id"].string, "ep499")
        XCTAssertEqual(model.player.played.last?.startSeconds, 49)
        await model.loadMoreEpisodes()
        XCTAssertEqual(EpisodeFixtureProtocol.episodeOffsets, [0, 80], "Adjacent rows must not shift the catalogue pagination offset")
        XCTAssertTrue(model.episodeQueue.contains { TVMedia.id($0) == "ep81" })
        XCTAssertEqual(Set(model.episodeQueue.map(TVMedia.id)).count, model.episodeQueue.count)
    }
    func testSwitchingSeasonAndEpisodeKeepsOneDetailAndOriginalReturnFocus() async throws {
        let model = await model()
        let library: JSONValue = .object(["Id": .string("library"), "Type": .string("CollectionFolder")])
        await model.open(library)
        await model.open(EpisodeFixtureProtocol.episode(1))
        let depth = model.pages.count
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.last))
        XCTAssertEqual(model.episodeQueue.map(TVMedia.id), ["s2ep1", "s2ep2"])
        XCTAssertEqual(model.selectedItem?["Id"].string, "ep1", "Choosing a season only changes the picker")
        await model.openEpisode(try XCTUnwrap(model.episodeQueue.last))
        XCTAssertEqual(model.pages.count, depth)
        XCTAssertEqual(model.selectedItem?["Id"].string, "s2ep2")
        XCTAssertEqual(model.currentEpisodeID, "s2ep2")
        XCTAssertFalse(model.canPlayNextEpisode)
        XCTAssertEqual(TVMedia.episodeLabel(try XCTUnwrap(model.selectedItem)), "S02E02")
        model.goBack()
        XCTAssertNil(model.selectedItem)
        XCTAssertEqual(model.focusTarget, "tv.item.ep1")
    }
    func testStoppedEpisodePositionIsUsedWhenSelectingItAgain() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        model.player.onStopped?(EpisodeFixtureProtocol.episode(1), 35, 100)
        await model.playNextEpisode()
        await model.playPreviousEpisode()
        XCTAssertEqual(model.player.played.last?.item["Id"].string, "ep1")
        XCTAssertEqual(model.player.played.last?.startSeconds, 35, "Use local stop progress until its server report is persisted")
    }
    func testClosingPlayerDuringPendingEpisodeSwitchDoesNotReopenIt() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        EpisodeFixtureProtocol.delayPlayback = true
        let switching = Task { await model.playNextEpisode() }
        try await Task.sleep(for: .milliseconds(40))
        model.player.stop()
        await switching.value
        XCTAssertFalse(model.player.active)
        XCTAssertEqual(model.player.played.count, 1)
        XCTAssertFalse(model.busy)
    }
    func testLeavingDetailDiscardsDelayedSeasonResponse() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        EpisodeFixtureProtocol.delaySeason = true
        let selecting = Task { await model.selectEpisodeSeason(try! XCTUnwrap(model.episodeSeasons.last)) }
        try await Task.sleep(for: .milliseconds(30))
        model.goBack()
        await selecting.value
        XCTAssertNil(model.selectedItem)
        XCTAssertTrue(model.episodeQueue.isEmpty)
        XCTAssertFalse(model.episodeLoading)
    }
    func testBrowsingAnotherSeasonDoesNotRemovePlayingEpisodeNeighbors() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(2))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first { TVMedia.id($0) == "ep2" }))
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.last))
        XCTAssertEqual(model.episodeSeasonID, "season2")
        XCTAssertEqual(model.selectedItem?["Id"].string, "ep2")
        XCTAssertTrue(model.canPlayPreviousEpisode && model.canPlayNextEpisode)
        await model.playPreviousEpisode()
        XCTAssertEqual(model.player.played.last?.item["Id"].string, "ep1")
    }
    func testSwitchFailureIsVisibleWithoutStoppingCurrentEpisode() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        EpisodeFixtureProtocol.failPlayback = true
        await model.playNextEpisode()
        XCTAssertNotNil(model.episodeError)
        XCTAssertTrue(model.player.active)
        XCTAssertEqual(model.currentEpisodeID, "ep1")
        XCTAssertFalse(model.busy)
    }
    func testCancelingPickerWorkReleasesBusyAndLoadingWithoutApplyingResponse() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        EpisodeFixtureProtocol.delayPlayback = true
        let switching = Task { await model.playNextEpisode() }
        try await Task.sleep(for: .milliseconds(30))
        switching.cancel(); await switching.value
        XCTAssertFalse(model.busy)
        XCTAssertEqual(model.player.played.count, 1)
        EpisodeFixtureProtocol.delaySeason = true
        let selecting = Task { await model.selectEpisodeSeason(try! XCTUnwrap(model.episodeSeasons.last)) }
        try await Task.sleep(for: .milliseconds(30))
        selecting.cancel(); await selecting.value
        XCTAssertFalse(model.episodeLoading)
        XCTAssertNil(model.episodeError)
        XCTAssertTrue(model.episodeQueue.isEmpty, "Canceled season response cannot populate the picker")
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.first))
        XCTAssertFalse(model.episodeQueue.isEmpty)
    }
    func testPlayerReplacementFailureRemainsVisibleAfterItsGenerationChanges() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        model.player.failNextPlayback = true
        await model.playNextEpisode()
        XCTAssertNotNil(model.episodeError)
        XCTAssertNotNil(model.error)
        XCTAssertFalse(model.player.active)
        XCTAssertFalse(model.busy)
    }
    func testStopPositionSurvivesSeasonSwitchAndDetailReload() async throws {
        let model = await model()
        await model.open(EpisodeFixtureProtocol.episode(1))
        model.player.onStopped?(EpisodeFixtureProtocol.episode(1), 35, 100)
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.last))
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.first))
        await model.openEpisode(try XCTUnwrap(model.episodeQueue.first))
        XCTAssertEqual(model.selectedItem.map(TVMedia.resumeSeconds), 35)
        await model.playEpisode(try XCTUnwrap(model.episodeQueue.first))
        XCTAssertEqual(model.player.played.last?.startSeconds, 35)
    }
    func testUnknownEpisodeNumbersDoNotFabricateSeasonZero() async {
        XCTAssertNil(TVMedia.episodeLabel(.object(["Type": .string("Episode"), "IndexNumber": .number(2)])))
        XCTAssertEqual(TVMedia.episodeLabel(.object(["Type": .string("Episode"), "ParentIndexNumber": .number(0), "IndexNumber": .number(1)])), "S00E01")
    }
    func testFixtureContainsSecondSeasonAndTrustworthyDetails() async throws {
        let model = TVAppModel(fixtureMode: true)
        await model.start()
        await model.open(.object(["Id": .string("fixture.show"), "Type": .string("Series")]))
        XCTAssertEqual(model.currentPage?.items.map(TVMedia.id), ["fixture.season", "fixture.season.2"])
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        XCTAssertEqual(model.episodeQueue.map(TVMedia.id), ["fixture.episode.1", "fixture.episode.2"])
        XCTAssertEqual(EmbyMediaDetails(item: try XCTUnwrap(model.selectedItem)).genres, ["科幻", "冒险"])
        await model.selectEpisodeSeason(try XCTUnwrap(model.episodeSeasons.last))
        XCTAssertEqual(model.episodeQueue.map(TVMedia.id), ["fixture.episode.s2.1", "fixture.episode.s2.2"])
    }
}

private final class EpisodeFixtureProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var offsets: [Int] = []
    static var delayPlayback = false
    static var delaySeason = false
    static var failPlayback = false
    static var episodeOffsets: [Int] { lock.withLock { offsets } }
    static func reset() { lock.withLock { offsets = []; delayPlayback = false; delaySeason = false; failPlayback = false } }
    static func episode(_ n: Int, season: Int = 1) -> JSONValue {
        .object(["Id": .string(season == 1 ? "ep\(n)" : "s2ep\(n)"), "Type": .string("Episode"), "Name": .string("Episode \(n)"),
                 "SeriesId": .string("show"), "SeasonId": .string("season\(season)"), "ParentIndexNumber": .number(Double(season)), "IndexNumber": .number(Double(n)),
                 "RunTimeTicks": .number(1_000_000_000), "UserData": .object(["PlaybackPositionTicks": .number(Double(n % 50) * 10_000_000)])])
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "episode-fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!, path = url.path
        let query = Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, new in new })
        let value: JSONValue
        var delayed = false
        if path.hasSuffix("/Views") { value = page([]) }
        else if path.hasSuffix("/Seasons") {
            value = page((1...2).map { .object(["Id": .string("season\($0)"), "Type": .string("Season"), "Name": .string("第 \($0) 季"), "IndexNumber": .number(Double($0)), "SeriesId": .string("show")]) })
        } else if path.hasSuffix("/Episodes") {
            let season = query["SeasonId"] == "season2" ? 2 : 1
            let count = season == 1 ? 501 : 2
            if let adjacent = query["AdjacentTo"] {
                let n = Int(adjacent.replacingOccurrences(of: season == 1 ? "ep" : "s2ep", with: "")) ?? 1
                value = page((max(1,n-1)...min(count,n+1)).map { Self.episode($0, season: season) })
            } else {
                let start = Int(query["StartIndex"] ?? "0") ?? 0
                Self.lock.withLock { Self.offsets.append(start) }
                let limit = min(80, Int(query["Limit"] ?? "80") ?? 80)
                value = page(Array((1...count).dropFirst(start).prefix(limit)).map { Self.episode($0, season: season) }, total: count)
                delayed = Self.delaySeason && season == 2
            }
        } else if path.hasSuffix("/PlaybackInfo") {
            if Self.failPlayback { client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return }
            value = .object(["MediaSources": .array([.object(["Id": .string("source"), "SupportsDirectPlay": .bool(true)])]), "PlaySessionId": .string("play-session")])
            delayed = Self.delayPlayback
        } else if path.contains("/Items/") {
            let id = url.lastPathComponent
            let season = id.hasPrefix("s2ep") ? 2 : 1
            let n = Int(id.replacingOccurrences(of: season == 1 ? "ep" : "s2ep", with: "")) ?? 1
            value = Self.episode(n, season: season)
        } else if path.hasSuffix("/Items") { value = page([Self.episode(1)]) }
        else { client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return }
        let send = { [self] in
            do {
                let data = try JSONEncoder().encode(value)
                client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!, cacheStoragePolicy: .notAllowed)
                client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
            } catch { client?.urlProtocol(self, didFailWithError: error) }
        }
        if delayed { DispatchQueue.global().asyncAfter(deadline: .now() + 0.2, execute: send) }
        else { send() }
    }
    override func stopLoading() {}
    private func page(_ items: [JSONValue], total: Int? = nil) -> JSONValue {
        .object(["Items": .array(items), "TotalRecordCount": .number(Double(total ?? items.count))])
    }
}
