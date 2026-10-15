import Foundation
import Testing
@testable import AppleCore

private struct HomeFixtureAPI: EmbyHomeAPI {
    let response: @Sendable (Bool, [String: String]) throws -> EmbyItemPage
    func items(query: [String: String]) async throws -> EmbyItemPage { try response(false, query) }
    func resumableItems(query: [String: String]) async throws -> EmbyItemPage { try response(true, query) }
}

private func homeItem(_ id: String, type: String = "Movie", added: String = "2026-10-01", played: Bool? = nil,
                      last: String? = nil, series: String? = nil, percent: Double? = nil) -> JSONValue {
    var object: [String: JSONValue] = ["Id": .string(id), "Type": .string(type), "Name": .string(id), "DateCreated": .string(added)]
    var user: [String: JSONValue] = [:]
    if let played { user["Played"] = .bool(played) }
    if let last { user["LastPlayedDate"] = .string(last) }
    if let percent { user["PlayedPercentage"] = .number(percent) }
    object["UserData"] = .object(user)
    if let series { object["SeriesId"] = .string(series); object["SeriesName"] = .string("Show " + series) }
    return .object(object)
}

private let homeLibrary: JSONValue = .object(["Id": .string("library"), "CollectionType": .string("tvshows")])

@Suite struct EmbyHomeDataTests {
    @Test func dedicatedLibrariesAndArtworkPreserveRealNamesAndThirdPartyLibraries() {
        let source = (0..<7).map { JSONValue.object(["Id": .string("lib\($0)"), "Name": .string("自建库\($0)")]) }
        let all = EmbyHomeData.libraries(source, serverID: "another-server")
        #expect(all.count == 8)
        #expect(all[6]["Name"].string == "自建库6")
        #expect(all.last?["kind"].string == "favorites")
        #expect(EmbyHomeData.libraries(source, serverID: "62526c3bf747439c99327ddec5fed4a8").count == 4)
        #expect(EmbyHomeData.libraryArtwork(.object(["Name": .string("阿你妹"), "CollectionType": .string("movies")])) == "anime")
        #expect(EmbyHomeData.libraryArtwork(.object(["CollectionType": .string("movies")])) == "movies")
    }

    @Test func newestUnwatchedEpisodePromotesWatchedSeriesAheadOfNeverWatchedWorks() async throws {
        let api = HomeFixtureAPI { resume, query in
            #expect(query["Fields"]?.contains("UserDataLastPlayedDate") == true)
            if let ids = query["Ids"] { return .init(items: ids.split(separator: ",").map { homeItem(String($0), type: "Series") }) }
            #expect(query["ParentId"] == "library")
            if resume { return .init(items: [homeItem("paused", last: "2026-10-07", percent: 40)]) }
            if query["IsPlayed"] == "true" { return .init(items: [homeItem("old-episode", type: "Episode", played: true, last: "2026-10-04", series: "show")]) }
            return .init(items: [homeItem("fresh", added: "2026-10-12"), homeItem("new-episode", type: "Episode", added: "2026-10-09", played: false, series: "show")])
        }
        let cards = try await EmbyHomeData(api: api).load(library: homeLibrary)
        #expect(cards.map(\.id) == ["show", "paused", "fresh"])
        #expect(cards[0].newEpisode?["Id"].string == "new-episode")
        #expect(cards[0].item["Type"].string == "Series")
        #expect(cards[1].resumeItem?["Id"].string == "paused")
    }

    @Test func latestCompletedEpisodeRemovesAnOlderEpisodeResumeBar() async throws {
        let api = HomeFixtureAPI { resume, query in
            if query["Ids"] != nil { return .init(items: [homeItem("show", type: "Series")]) }
            if resume { return .init(items: [homeItem("old", type: "Episode", last: "2026-10-02", series: "show", percent: 50)]) }
            if query["IsPlayed"] == "true" { return .init(items: [homeItem("done", type: "Episode", played: true, last: "2026-10-08", series: "show")]) }
            return .init(items: [])
        }
        let cards = try await EmbyHomeData(api: api).load(library: homeLibrary)
        #expect(cards.count == 1)
        #expect(cards[0].id == "show")
        #expect(cards[0].resumeItem == nil)
    }

    @Test func favoriteSeriesIncludesItsUnfavoritedResumableEpisodeButNotOtherWorks() async throws {
        let api = HomeFixtureAPI { resume, query in
            if query["Ids"] != nil { return .init(items: [homeItem("favorite", type: "Series")]) }
            if resume {
                #expect(query["IsFavorite"] == nil)
                #expect(query["ParentId"] == nil)
                return .init(items: [homeItem("unrelated", last: "2026-10-12"), homeItem("episode", type: "Episode", last: "2026-10-09", series: "favorite")])
            }
            if query["IsFavorite"] == "true" { return .init(items: [homeItem("favorite", type: "Series")]) }
            return .init(items: [])
        }
        let cards = try await EmbyHomeData(api: api).load(library: EmbyHomeData.favorites)
        #expect(cards.map(\.id) == ["favorite"])
        #expect(cards[0].resumeItem?["Id"].string == "episode")
    }

    @Test func recentPagesPastOneHundredEpisodesFromSameWorkAndHydratesSeriesMetadata() async throws {
        let api = HomeFixtureAPI { resume, query in
            #expect(!resume)
            if let ids = query["Ids"] {
                return .init(items: ids.split(separator: ",").map { .object(["Id": .string(String($0)), "Type": .string("Series"), "Overview": .string("Work synopsis")]) })
            }
            if query["StartIndex"] == "0" { return .init(items: (0..<100).map { homeItem("ep\($0)", type: "Episode", series: "first") }, totalRecordCount: 101) }
            return .init(items: [homeItem("second", added: "2026-09-01")], totalRecordCount: 101)
        }
        let cards = try await EmbyHomeData(api: api).load(library: homeLibrary, order: .recent)
        #expect(cards.map(\.id) == ["first", "second"])
        #expect(cards[0].item["Overview"].string == "Work synopsis")
    }

    @Test func unavailableOrInconsistentEpisodeCountsDoNotInventZero() async throws {
        let api = HomeFixtureAPI { _, query in
            #expect(query["Limit"] == "0")
            #expect(query["ExcludeLocationTypes"] == "Virtual")
            #expect(query["IsMissing"] == "false")
            let id = query["ParentId"]
            if id == "good" { return .init(items: [], totalRecordCount: query["IsPlayed"] == "true" ? 3 : 10) }
            if id == "bad" { return .init(items: [], totalRecordCount: query["IsPlayed"] == "true" ? 4 : 2) }
            return .init(items: [])
        }
        let cards = ["good", "bad", "unknown"].map { EmbyHomeCard(item: homeItem($0, type: "Series")) }
        let result = try await EmbyHomeData(api: api).watchProgress(cards)
        #expect(result[0].watchState.played == 3)
        #expect(result[0].watchState.total == 10)
        #expect(result[0].watchState.unwatched == true)
        #expect(result[1].watchState.total == nil)
        #expect(result[2].watchState.unwatched == nil)
    }

    @Test func ratingQueriesSeriesAndOrdersWorksInsteadOfEpisodes() async throws {
        let api = HomeFixtureAPI { resume, query in
            #expect(!resume)
            #expect(query["IncludeItemTypes"] == "Series")
            #expect(query["SortBy"] == "CommunityRating,SortName")
            return .init(items: [.object(["Id": .string("low"), "CommunityRating": .number(6)]), .object(["Id": .string("high"), "CommunityRating": .number(9)])])
        }
        #expect(try await EmbyHomeData(api: api).load(library: homeLibrary, order: .rating).map(\.id) == ["high", "low"])
    }

    @Test func heroUsesParentBackdropWhilePosterUsesPrimary() {
        let item: JSONValue = .object(["Id": .string("episode"), "ImageTags": .object(["Primary": .string("poster")]), "ParentBackdropItemId": .string("series"), "ParentBackdropImageTags": .array([.string("parent-art")])])
        let hero = EmbyHomeArtwork.select(item, purpose: .hero)
        #expect(hero?.itemID == "series")
        #expect(hero?.type == "Backdrop")
        #expect(hero?.index == 0)
        #expect(hero?.tag == "parent-art")
        #expect(EmbyHomeArtwork.select(item, purpose: .poster)?.tag == "poster")
        #expect(EmbyHomeArtwork.select(.object(["Id": .string("empty")]), purpose: .hero) == nil)
    }

    @Test func returningSeriesOutsideHistoryWindowIsRecognisedWhenNewEpisodeArrives() async throws {
        let api = HomeFixtureAPI { resume, query in
            if let ids = query["Ids"] { return .init(items: ids.split(separator: ",").map { homeItem(String($0), type: "Series") }) }
            if resume { return .init(items: []) }
            if query["ParentId"] == "returning" {
                #expect(query["Limit"] == "1")
                #expect(query["IsPlayed"] == "true")
                return .init(items: [homeItem("old-episode", type: "Episode", played: true, last: "2026-03-01", series: "returning")])
            }
            if query["ParentId"] == "stranger" { return .init(items: []) }
            if query["IsPlayed"] == "true" {
                #expect(query["StartIndex"] == "0")
                return .init(items: (0..<100).map { homeItem("film-\($0)", played: true, last: "2026-10-09") }, totalRecordCount: 150)
            }
            return .init(items: [homeItem("returning-new", type: "Episode", added: "2026-10-12", played: false, series: "returning"), homeItem("stranger-new", type: "Episode", added: "2026-10-11", played: false, series: "stranger")])
        }
        let cards = try await EmbyHomeData(api: api).load(library: homeLibrary)
        #expect(cards.count == 24)
        #expect(cards[0].id == "returning")
        #expect(cards[0].newEpisode?["Id"].string == "returning-new")
        #expect(!cards.contains { $0.id == "stranger" })
    }

    @Test func watchedSeriesOutsideRecentWindowLooksUpItsNewestAvailableEpisode() async throws {
        let api = HomeFixtureAPI { resume, query in
            if let ids = query["Ids"] { return .init(items: ids.split(separator: ",").map { homeItem(String($0), type: "Series") }) }
            if resume { return .init(items: []) }
            if query["ParentId"] == "watched" {
                #expect(query["ExcludeLocationTypes"] == "Virtual")
                #expect(query["SortBy"] == "DateCreated,SortName")
                return .init(items: [homeItem("watched-new", type: "Episode", added: "2026-09-25", played: false, series: "watched")])
            }
            if query["IsPlayed"] == "true" { return .init(items: [homeItem("film", played: true, last: "2026-09-20"), homeItem("old-episode", type: "Episode", played: true, last: "2026-09-01", series: "watched")]) }
            return .init(items: (0..<100).map { homeItem("new-\($0)", added: "2026-10-10") }, totalRecordCount: 200)
        }
        let cards = try await EmbyHomeData(api: api).load(library: homeLibrary)
        #expect(Array(cards.prefix(3)).map(\.id) == ["watched", "film", "new-0"])
        #expect(cards[0].newEpisode?["Id"].string == "watched-new")
    }

    @Test func favoritesScanAllPagesBeforeSortingByLatestEpisode() async throws {
        let api = HomeFixtureAPI { resume, query in
            #expect(!resume)
            if query["IsFavorite"] == "true" {
                let offset = Int(query["StartIndex"] ?? "0")!
                return .init(items: (offset..<min(offset + 100, 101)).map { homeItem("favorite-\($0)", type: "Series", added: "2020-01-01") }, totalRecordCount: 101)
            }
            let id = query["ParentId"]!
            return .init(items: [homeItem("latest-" + id, type: "Episode", added: id == "favorite-100" ? "2026-10-09" : "2026-10-01", series: id)])
        }
        let cards = try await EmbyHomeData(api: api).load(library: EmbyHomeData.favorites, order: .recent)
        #expect(cards.count == 24)
        #expect(cards[0].id == "favorite-100")
    }
}
