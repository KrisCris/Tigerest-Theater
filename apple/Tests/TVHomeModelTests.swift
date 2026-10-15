import AppleCore
import Foundation
import XCTest
@testable import TVHomeModel

@MainActor final class TVHomeModelTests: XCTestCase {
    private func model() async throws -> TVAppModel {
        _ = URLProtocol.registerClass(HomeFixtureProtocol.self)
        HomeFixtureProtocol.reset()
        let session = EmbySession(serverURL: "https://home-fixture.invalid", userID: "user", accessToken: "fixture", deviceID: "fixture", serverID: "fixture")
        let model = TVAppModel(fixtureMode: false, store: TVSessionStore(initialSession: session))
        await model.start()
        try await eventually { model.homeCards.count == 2 }
        addTeardownBlock { URLProtocol.unregisterClass(HomeFixtureProtocol.self) }
        return model
    }
    private func eventually(_ condition: () -> Bool) async throws {
        for _ in 0..<100 {
            if condition() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertTrue(condition(), "Expected home state never arrived")
    }
    func testStoppedWorkOutsideHomeAppearsOnlyAfterReportCompletes() async throws {
        let model = try await model()
        let client = try XCTUnwrap(model.client)
        await model.open(try XCTUnwrap(model.selectedHomeLibrary))
        await model.open(HomeFixtureProtocol.movie("new"))
        model.player.onStopped?(HomeFixtureProtocol.movie("new"), 50, 100)
        model.goBack(); model.goBack()
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(model.homeCards.map(\.id), ["old", "other"], "Keep the row until the delayed stop report finishes")
        HomeFixtureProtocol.finishStop()
        model.player.onStopReported?(HomeFixtureProtocol.movie("new"), client)
        try await eventually { model.homeCards.first?.id == "new" }
        XCTAssertEqual(model.homeCards.first?.resumeItem?["UserData"]["PlayedPercentage"].number, 50)
        XCTAssertEqual(model.focusTarget, "tv.library.library")
    }
    func testLocalProgressUpdatesExistingCardBeforeNetworkRoundTrip() async throws {
        let model = try await model()
        model.selectHomeCard("old")
        await model.open(HomeFixtureProtocol.movie("old"))
        model.player.onStopped?(HomeFixtureProtocol.movie("old"), 50, 100)
        XCTAssertEqual(model.homeCards.first?.resumeItem?["UserData"]["PlayedPercentage"].number, 50)
        XCTAssertEqual(model.selectedItem?["UserData"]["PlaybackPositionTicks"].number, 500_000_000)
    }
    func testLateStopReportDoesNotRepopulateLoggedOutHome() async throws {
        let model = try await model()
        let client = try XCTUnwrap(model.client)
        model.player.onStopped?(HomeFixtureProtocol.movie("new"), 50, 100)
        await model.logout()
        HomeFixtureProtocol.finishStop()
        model.player.onStopReported?(HomeFixtureProtocol.movie("new"), client)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertFalse(model.isAuthenticated)
        XCTAssertTrue(model.homeCards.isEmpty)
    }
    func testReturningFocusKeepsSelectedWorkDuringDirtyRefresh() async throws {
        let model = try await model()
        let client = try XCTUnwrap(model.client)
        model.selectHomeCard("other")
        await model.open(HomeFixtureProtocol.movie("other"))
        model.player.onStopped?(HomeFixtureProtocol.movie("other"), 50, 100)
        model.goBack()
        HomeFixtureProtocol.finishStop()
        model.player.onStopReported?(HomeFixtureProtocol.movie("other"), client)
        // Restoring a library focus can invoke the home view's preview callback.
        model.previewLibrary("library")
        XCTAssertEqual(model.homeCardID, "other")
        try await eventually { model.homeCards.first?.id == "new" }
        XCTAssertEqual(model.homeCardID, "other")
        XCTAssertEqual(model.focusTarget, "tv.item.other")
    }
    func testConsecutiveStopsWaitForBothReports() async throws {
        let model = try await model()
        let client = try XCTUnwrap(model.client)
        await model.open(HomeFixtureProtocol.movie("new"))
        model.player.onStopped?(HomeFixtureProtocol.movie("new"), 20, 100)
        model.player.onStopped?(HomeFixtureProtocol.movie("new"), 50, 100)
        model.goBack()
        model.player.onStopReported?(HomeFixtureProtocol.movie("new"), client)
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(model.homeCards.map(\.id), ["old", "other"])
        HomeFixtureProtocol.finishStop()
        model.player.onStopReported?(HomeFixtureProtocol.movie("new"), client)
        try await eventually { model.homeCards.first?.id == "new" }
    }
    func testLibraryOpensRecursiveWorksAndPaginatesWithoutFolderLevel() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.open(try XCTUnwrap(model.selectedHomeLibrary))
        XCTAssertEqual(model.currentPage?.items.count, 80)
        XCTAssertEqual(model.currentPage?.items.first?["Type"].string, "Movie")
        XCTAssertEqual(model.currentPage?.hasMore, true)
        await model.loadMore()
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.currentPage?.hasMore, false)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
        await model.open(try XCTUnwrap(model.currentPage?.items.last))
        model.goBack()
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
        model.goBack()
        XCTAssertEqual(model.focusTarget, "tv.library.library")
    }
    func testSeriesLibraryStillNavigatesSeasonsThenEpisodes() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.open(try XCTUnwrap(model.libraries.first { $0["Id"].string == "series-library" }))
        XCTAssertEqual(model.currentPage?.items.first?["Type"].string, "Series")
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        XCTAssertEqual(model.currentPage?.items.first?["Type"].string, "Season")
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        XCTAssertEqual(model.currentPage?.items.first?["Type"].string, "Episode")
        XCTAssertEqual(model.currentPage?.items.first.map(TVMedia.episodeLabel), "S01E01")
        model.goBack()
        XCTAssertEqual(model.focusTarget, "tv.item.season")
        model.goBack()
        XCTAssertEqual(model.focusTarget, "tv.item.show")
    }
    func testFavoriteWorksHaveBoundedPages() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.open(EmbyHomeData.favorites)
        XCTAssertEqual(model.currentPage?.items.count, 80)
        XCTAssertEqual(model.currentPage?.hasMore, true)
        await model.loadMore()
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.currentPage?.hasMore, false)
        XCTAssertTrue(model.currentPage?.items.allSatisfy { $0["Type"].string == "Movie" } == true)
    }

    func testHomeMovieReturnsToItsLibraryAndFindsWorkAfterFirstPage() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        XCTAssertEqual(model.selectedItem?["Id"].string, "movie80")
        XCTAssertEqual(model.pages.map { TVMedia.id($0.item) }, ["library"])
        // A second callback from the now-hidden home view must not stack pages.
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        XCTAssertEqual(model.pages.count, 1)
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
        XCTAssertEqual(model.currentPage?.hasMore, false)
        let wallID = model.currentPage?.id
        await model.open(HomeFixtureProtocol.movie("movie80"))
        model.goBack()
        XCTAssertEqual(model.pages.count, 1)
        XCTAssertEqual(model.currentPage?.id, wallID)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
        model.goBack()
        XCTAssertEqual(model.focusTarget, "tv.library.library")
    }

    func testHomeSeriesKeepsLibrarySeasonAndEpisodeReturnLevels() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        model.previewLibrary("series-library")
        await model.openHomeWork(HomeFixtureProtocol.series())
        XCTAssertEqual(model.pages.map { TVMedia.id($0.item) }, ["series-library", "show"])
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        await model.open(try XCTUnwrap(model.currentPage?.items.first))
        model.goBack()
        XCTAssertEqual(model.currentPage?.item["Id"].string, "season")
        XCTAssertEqual(model.focusTarget, "tv.item.episode")
        model.goBack()
        XCTAssertEqual(model.currentPage?.item["Id"].string, "show")
        XCTAssertEqual(model.focusTarget, "tv.item.season")
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertEqual(model.currentPage?.item["Id"].string, "series-library")
        XCTAssertEqual(model.currentPage?.items.map { TVMedia.id($0) }, ["show"])
        XCTAssertEqual(model.focusTarget, "tv.item.show")
    }

    func testUnavailableReturnWallDoesNotBlockDetailAndCanRetry() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        HomeFixtureProtocol.failWall(at: 0)
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        XCTAssertEqual(model.selectedItem?["Id"].string, "movie80")
        XCTAssertNil(model.error)
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertEqual(model.currentPage?.item["Id"].string, "library")
        XCTAssertNotNil(model.error)
        XCTAssertEqual(model.focusTarget, "tv.retry")
        HomeFixtureProtocol.failWall(at: nil)
        await model.retry()
        XCTAssertNil(model.selectedItem, "Retry must load the wall, not reopen the detail")
        XCTAssertNil(model.error)
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
    }

    func testReturnWallRetryResumesFailedPageWithoutLosingPosition() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        HomeFixtureProtocol.failWall(at: 80)
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertNotNil(model.error)
        XCTAssertEqual(model.currentPage?.items.count, 80)
        HomeFixtureProtocol.failWall(at: nil)
        await model.retry()
        XCTAssertNil(model.error)
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
    }

    func testRepeatedExitCallbackOnlyPopsItsOriginalPage() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.open(try XCTUnwrap(model.selectedHomeLibrary))
        await model.open(HomeFixtureProtocol.movie("movie0"))
        let detailContext = model.navigationContext
        model.handleExit(from: detailContext)
        model.handleExit(from: detailContext)
        XCTAssertEqual(model.pages.count, 1)
        XCTAssertEqual(model.currentPage?.item["Id"].string, "library")
        XCTAssertEqual(model.focusTarget, "tv.item.movie0")
        model.handleExit(from: model.navigationContext)
        XCTAssertTrue(model.pages.isEmpty)
        XCTAssertEqual(model.focusTarget, "tv.library.library")
    }

    func testHomeFavoriteReturnsToFavoritesAndRestoresLaterPage() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        model.previewLibrary(TVMedia.id(EmbyHomeData.favorites))
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertEqual(model.currentPage?.item["kind"].string, "favorites")
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.focusTarget, "tv.item.movie80")
    }

    func testMissingHomeWorkStopsAtEndOfReturnWall() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.openHomeWork(HomeFixtureProtocol.movie("removed"))
        model.goBack()
        try await eventually { !model.busy }
        XCTAssertNil(model.error)
        XCTAssertEqual(model.currentPage?.items.count, 81)
        XCTAssertEqual(model.currentPage?.hasMore, false)
        XCTAssertEqual(model.focusTarget, "tv.item.movie0")
    }

    func testLeavingPendingReturnWallDoesNotReopenIt() async throws {
        let model = try await model()
        HomeFixtureProtocol.enablePosterWall()
        await model.openHomeWork(HomeFixtureProtocol.movie("movie80"))
        model.goBack()
        model.goBack()
        await model.logout()
        try await Task.sleep(for: .milliseconds(30))
        XCTAssertTrue(model.pages.isEmpty)
        XCTAssertNil(model.selectedItem)
        XCTAssertNil(model.error)
        XCTAssertFalse(model.busy)
        XCTAssertFalse(model.isAuthenticated)
    }
}

private final class HomeFixtureProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var stopped = false
    private static var posterWall = false
    private static var failedWallOffset: Int?
    static func reset() { lock.withLock { stopped = false; posterWall = false; failedWallOffset = nil } }
    static func finishStop() { lock.withLock { stopped = true } }
    static func enablePosterWall() { lock.withLock { posterWall = true } }
    static func failWall(at offset: Int?) { lock.withLock { failedWallOffset = offset } }
    static func series() -> JSONValue { .object(["Id": .string("show"), "Name": .string("Show"), "Type": .string("Series")]) }
    static func movie(_ id: String) -> JSONValue {
        .object(["Id": .string(id), "Name": .string(id), "Type": .string("Movie"), "DateCreated": .string("2026-01-01T00:00:00Z"),
                 "RunTimeTicks": .number(1_000_000_000), "UserData": .object(["PlaybackPositionTicks": .number(0), "PlayedPercentage": .number(0), "Played": .bool(false)])])
    }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "home-fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!, path = url.path
        let query = Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, new in new })
        let (afterStop, posterWall) = Self.lock.withLock { (Self.stopped, Self.posterWall) }
        if query["SortBy"] == "SortName", query["ParentId"] == "library",
           let failedOffset = Self.lock.withLock({ Self.failedWallOffset }), Int(query["StartIndex"] ?? "0") == failedOffset {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)); return
        }
        let value: JSONValue
        if path.hasSuffix("/Views") {
            value = page([.object(["Id": .string("library"), "Name": .string("Movies"), "Type": .string("CollectionFolder"), "CollectionType": .string("movies")]),
                          .object(["Id": .string("series-library"), "Name": .string("Anime"), "Type": .string("CollectionFolder"), "CollectionType": .string("tvshows")])])
        } else if path.hasSuffix("/Shows/show/Seasons") {
            value = page([.object(["Id": .string("season"), "Name": .string("Season 1"), "Type": .string("Season"), "SeriesId": .string("show")])])
        } else if path.hasSuffix("/Shows/show/Episodes"), query["SeasonId"] == "season" {
            value = page([.object(["Id": .string("episode"), "Name": .string("Episode 1"), "Type": .string("Episode"), "ParentIndexNumber": .number(1), "IndexNumber": .number(1)])])
        } else if path.hasSuffix("/Items/Resume") {
            var recent = Self.movie("new").object!
            recent["UserData"] = .object(["PlaybackPositionTicks": .number(500_000_000), "PlayedPercentage": .number(50), "LastPlayedDate": .string("2026-10-15T00:00:00Z"), "Played": .bool(false)])
            value = page(afterStop ? [.object(recent)] : [])
        } else if path.hasSuffix("/Items") {
            if posterWall, query["Recursive"] == "false" {
                value = page([.object(["Id": .string("server-folder"), "Name": .string("Anime Files"), "Type": .string("Folder"), "IsFolder": .bool(true)])])
            } else if posterWall, query["ParentId"] == "series-library", query["Recursive"] == "true", query["IncludeItemTypes"] == "Series" {
                value = page([.object(["Id": .string("show"), "Name": .string("Show"), "Type": .string("Series")])])
            } else if posterWall, query["IsFavorite"] == "true" || (query["Recursive"] == "true" && query["IncludeItemTypes"] == "Movie") {
                let start = Int(query["StartIndex"] ?? "0") ?? 0, limit = Int(query["Limit"] ?? "80") ?? 80
                let movies = (0..<81).map { Self.movie("movie\($0)") }
                value = .object(["Items": .array(Array(movies.dropFirst(start).prefix(limit))), "TotalRecordCount": .number(81)])
            } else {
                value = page(query["IsPlayed"] == "true" ? [] : [Self.movie("old"), Self.movie("other")])
            }
        } else if path.contains("/Items/") {
            if url.lastPathComponent == "show" { value = .object(["Id": .string("show"), "Name": .string("Show"), "Type": .string("Series")]) }
            else if url.lastPathComponent == "season" { value = .object(["Id": .string("season"), "Name": .string("Season 1"), "Type": .string("Season"), "SeriesId": .string("show")]) }
            else { value = Self.movie(url.lastPathComponent) }
        } else {
            client?.urlProtocol(self, didFailWithError: URLError(.unsupportedURL)); return
        }
        do {
            let data = try JSONEncoder().encode(value)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
    private func page(_ items: [JSONValue]) -> JSONValue { .object(["Items": .array(items), "TotalRecordCount": .number(Double(items.count))]) }
}
