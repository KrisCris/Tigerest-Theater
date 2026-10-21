import Foundation

public enum EmbyHomeOrder: String, CaseIterable, Codable, Sendable {
    case resume, recent, release, rating
    public var title: String {
        switch self { case .resume: "继续观看"; case .recent: "最近入库"; case .release: "发行时间"; case .rating: "评分" }
    }
}

/// Order of a library's poster wall. Emby and Jellyfin accept the same sort
/// fields; ties fall back to the name.
public enum EmbyLibrarySort: String, CaseIterable, Codable, Sendable {
    case name, recent, release, rating
    public var title: String {
        switch self { case .name: "名称"; case .recent: "最近添加"; case .release: "发行时间"; case .rating: "评分" }
    }
    var sortBy: String {
        switch self {
        case .name: "SortName"
        case .recent: "DateCreated,SortName"
        case .release: "PremiereDate,ProductionYear,SortName"
        case .rating: "CommunityRating,SortName"
        }
    }
    var sortOrder: String { self == .name ? "Ascending" : "Descending" }
}

public struct EmbyHomeWatchState: Sendable, Equatable {
    public var unwatched: Bool?
    public var played: Int?
    public var total: Int?
    public init(unwatched: Bool? = nil, played: Int? = nil, total: Int? = nil) {
        self.unwatched = unwatched; self.played = played; self.total = total
    }
    public var description: String? {
        guard let played, let total, total > 0 else { return nil }
        return "观看进度：\(played)/\(total)"
    }
}

public struct EmbyHomeCard: Identifiable, Sendable, Equatable {
    public var item: JSONValue
    public var addedAt: String
    public var latestEpisode: JSONValue?
    public var resumeItem: JSONValue?
    public var newEpisode: JSONValue?
    public var lastPlayed: TimeInterval = 0
    public var watchState: EmbyHomeWatchState
    var needsHydration = false
    var hasPlaybackHistory = false
    public var id: String { item["Id"].string ?? "" }
    public init(item: JSONValue, addedAt: String? = nil, latestEpisode: JSONValue? = nil, resumeItem: JSONValue? = nil) {
        self.item = item; self.addedAt = addedAt ?? item["DateCreated"].string ?? ""
        self.latestEpisode = latestEpisode; self.resumeItem = resumeItem
        self.watchState = .init(unwatched: item["UserData"]["Played"].bool.map { !$0 })
    }
}

public struct EmbyHomeArtwork: Sendable, Equatable {
    public enum Purpose: Sendable, Equatable {
        case hero, poster, cover
        public var maxWidth: Int { switch self { case .hero: 1920; case .poster: 960; case .cover: 480 } }
    }
    public let itemID: String
    public let type: String
    public let index: Int?
    public let tag: String
    public static func select(_ item: JSONValue, purpose: Purpose) -> Self? {
        guard let id = item["Id"].string else { return nil }
        func image(_ type: String) -> Self? {
            guard let tag = item["ImageTags"][type].string, !tag.isEmpty else { return nil }
            return .init(itemID: id, type: type, index: nil, tag: tag)
        }
        if purpose == .poster, let primary = image("Primary") { return primary }
        if purpose == .cover, let cover = image("Thumb") ?? image("Primary") { return cover }
        if let tag = item["BackdropImageTags"].array?.first?.string, !tag.isEmpty {
            return .init(itemID: id, type: "Backdrop", index: 0, tag: tag)
        }
        if let parent = item["ParentBackdropItemId"].string, let tag = item["ParentBackdropImageTags"].array?.first?.string, !tag.isEmpty {
            return .init(itemID: parent, type: "Backdrop", index: 0, tag: tag)
        }
        return image("Thumb") ?? image("Primary")
    }
}

/// Native port of native/homeData.js. Cards are works; episode records provide activity.
public struct EmbyHomeData: Sendable {
    public let api: any EmbyHomeAPI
    public init(api: any EmbyHomeAPI) { self.api = api }
    public static let favorites: JSONValue = .object(["Id": .string("tigerest-favorites"), "Name": .string("收藏"), "kind": .string("favorites")])
    private static let fields = "DateCreated,Overview,Genres,PrimaryImageAspectRatio,PremiereDate,CommunityRating,PresentationUniqueKey,UserDataLastPlayedDate"
    private static let images = ["EnableUserData": "true", "EnableImageTypes": "Primary,Backdrop,Thumb", "ImageTypeLimit": "1"]
    private static let types = ["music": "MusicAlbum", "books": "Book,AudioBook", "audiobooks": "MusicAlbum,AudioBook", "musicvideos": "MusicVideo", "games": "Game", "playlists": "Playlist", "photos": "Photo,PhotoAlbum"]
    private static func favorite(_ library: JSONValue) -> Bool { library["kind"].string == "favorites" }
    private static func playable(_ library: JSONValue) -> String {
        types[library["CollectionType"].string ?? ""] ?? "Episode,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game"
    }
    public static func libraries(_ items: [JSONValue], serverID: String?) -> [JSONValue] {
        let accessible = items.filter { !($0["Id"].string ?? "").isEmpty }
        return (serverID == "62526c3bf747439c99327ddec5fed4a8" ? Array(accessible.prefix(3)) : accessible) + [favorites]
    }
    public static func libraryArtwork(_ library: JSONValue) -> String {
        if favorite(library) { return "favorites" }
        if (library["Name"].string ?? "").range(of: "动漫|动画|[阿啊]你妹|anime|アニメ", options: .caseInsensitive.union(.regularExpression)) != nil { return "anime" }
        return library["CollectionType"].string == "movies" ? "movies" : "series"
    }

    private struct Scan: Sendable { var cards: [EmbyHomeCard]; var complete: Bool; var oldest: TimeInterval }
    private struct Record: Sendable { var card: EmbyHomeCard; var item: JSONValue; var at: TimeInterval }
    private struct History: Sendable { var records: [Record]; var cutoff: TimeInterval }

    public func load(library: JSONValue, order: EmbyHomeOrder = .resume) async throws -> [EmbyHomeCard] {
        try Task.checkCancellation()
        if order != .resume { return try await ordered(library: library, order: order) }
        let favoriteScan = Self.favorite(library) ? try await collect(library: library, order: .recent, limit: .max) : nil
        let allowed = favoriteScan.map { Set($0.cards.map(\.id)) }
        async let resumedResult = history(library: library, resume: true, allowed: allowed)
        async let playedResult = history(library: library, resume: false, allowed: allowed)
        let recent: Scan
        if let favoriteScan { recent = favoriteScan }
        else { recent = try await collect(library: library, order: .recent, limit: 24) }
        let (resumed, played) = try await (resumedResult, playedResult)
        try Task.checkCancellation()
        let scanned = Dictionary(uniqueKeysWithValues: recent.cards.map { ($0.id, $0) })
        var cards: [String: EmbyHomeCard] = [:], insertion: [String] = []
        func watched(_ record: Record) -> EmbyHomeCard {
            if let known = cards[record.card.id] { return known }
            insertion.append(record.card.id)
            var value = scanned[record.card.id] ?? record.card
            value.lastPlayed = record.at
            value.hasPlaybackHistory = true
            return value
        }
        for record in resumed.records {
            var card = watched(record); card.resumeItem = record.item; cards[card.id] = card
        }
        for record in played.records {
            var card = watched(record)
            if record.at > card.lastPlayed { card.lastPlayed = record.at; card.resumeItem = nil }
            cards[card.id] = card
        }
        for id in insertion { if var card = cards[id] { Self.arrived(&card, episode: card.latestEpisode); cards[id] = card } }
        let cutoff = max(resumed.cutoff, played.cutoff)
        let unknownLatest = recent.complete ? [] : insertion.compactMap { cards[$0] }.filter {
            $0.item["Type"].string == "Series" && $0.latestEpisode == nil && $0.lastPlayed < recent.oldest
        }.sorted { $0.lastPlayed > $1.lastPlayed }.prefix(8).map { $0 }
        let unknownHistory = cutoff == 0 ? [] : recent.cards.filter {
            cards[$0.id] == nil && $0.latestEpisode != nil && $0.latestEpisode?["UserData"]["Played"].bool != true && Self.stamp($0.latestEpisode?["DateCreated"].string) > cutoff
        }.prefix(8).map { $0 }
        let lookups = unknownLatest.map { ($0, false) } + unknownHistory.map { ($0, true) }
        for start in stride(from: 0, to: lookups.count, by: 6) {
            let batch = Array(lookups[start..<min(start + 6, lookups.count)])
            let results = try await withThrowingTaskGroup(of: (EmbyHomeCard, Bool, JSONValue?).self) { group in
                for (card, played) in batch {
                    group.addTask {
                        try Task.checkCancellation()
                        var query = Self.episodeQuery(parentID: card.id, limit: 1)
                        query["Fields"] = "DateCreated,UserDataLastPlayedDate"; query["EnableUserData"] = "true"; query["EnableImages"] = "false"
                        query["SortBy"] = played ? "DatePlayed,SortName" : "DateCreated,SortName"; query["SortOrder"] = "Descending"
                        if played { query["IsPlayed"] = "true" }
                        do { return (card, played, try await api.items(query: query).items.first) }
                        catch { try Task.checkCancellation(); return (card, played, nil) }
                    }
                }
                var results: [(EmbyHomeCard, Bool, JSONValue?)] = []
                for try await result in group { results.append(result) }
                return results
            }
            for (known, isHistory, episode) in results {
                guard let episode else { continue }
                if isHistory {
                    guard episode["UserData"]["Played"].bool == true else { continue }
                    let record = Record(card: known, item: episode, at: Self.stamp(episode["UserData"]["LastPlayedDate"].string))
                    var card = watched(record); Self.arrived(&card, episode: known.latestEpisode); cards[card.id] = card
                } else if var card = cards[known.id] {
                    card.latestEpisode = episode; card.addedAt = episode["DateCreated"].string ?? card.addedAt
                    Self.arrived(&card, episode: episode); cards[card.id] = card
                }
            }
        }
        let continuing = Self.sorted(insertion.compactMap { cards[$0] }) { max($0.lastPlayed, Self.stamp($0.newEpisode?["DateCreated"].string)) }
        var visible = continuing.map { value in
            var card = value
            if let episode = card.newEpisode { card.latestEpisode = episode; card.addedAt = episode["DateCreated"].string ?? card.addedAt }
            return card
        }
        visible = try await hydrate(visible)
        visible += recent.cards.filter { cards[$0.id] == nil }
        let combined = Self.uniqueWorks(visible)
        let watched = Self.sorted(combined.filter(\.hasPlaybackHistory)) { max($0.lastPlayed, Self.stamp($0.newEpisode?["DateCreated"].string)) }
        let remaining = Self.sorted(combined.filter { !$0.hasPlaybackHistory }) { Self.stamp($0.addedAt) }
        return Self.withWatchState(Array((watched + remaining).prefix(24)))
    }

    public func ordered(library: JSONValue, order: EmbyHomeOrder = .recent, limit: Int = 24) async throws -> [EmbyHomeCard] {
        Self.withWatchState(Array(Self.uniqueWorks(try await collect(library: library, order: order, limit: limit).cards).prefix(max(0, limit))))
    }

    private func history(library: JSONValue, resume: Bool, allowed: Set<String>?) async throws -> History {
        var query = Self.images.merging(["Recursive": "true", "SortBy": "DatePlayed,SortName", "SortOrder": "Descending", "Limit": "100", "Fields": Self.fields, "IncludeItemTypes": Self.playable(library)]) { _, new in new }
        if !Self.favorite(library) { query["ParentId"] = library["Id"].string }
        if !resume { query["IsPlayed"] = "true" }
        var records: [String: Record] = [:], insertion: [String] = [], pages = Set<String>()
        var complete = false, oldest: TimeInterval = 0
        do {
            for page in 0..<10 {
                try Task.checkCancellation()
                query["StartIndex"] = String(page * 100)
                let result: EmbyItemPage
                if resume { result = try await api.resumableItems(query: query) }
                else { result = try await api.items(query: query) }
                try Task.checkCancellation()
                let key = result.items.map { $0["Id"].string ?? "" }.joined(separator: ",")
                if !pages.insert(key).inserted { complete = true; break }
                for item in result.items {
                    let at = Self.stamp(item["UserData"]["LastPlayedDate"].string)
                    if at > 0, oldest == 0 || at < oldest { oldest = at }
                    if !resume, item["UserData"]["Played"].bool != true || at == 0 { continue }
                    var card = Self.workCard(item)
                    card.latestEpisode = nil
                    card.addedAt = card.item["DateCreated"].string ?? ""
                    guard !card.id.isEmpty, allowed == nil || allowed!.contains(card.id) else { continue }
                    if records[card.id] == nil { insertion.append(card.id) }
                    if records[card.id] == nil || at > records[card.id]!.at { records[card.id] = .init(card: card, item: item, at: at) }
                }
                if result.items.count < 100 || result.totalRecordCount.map({ (page + 1) * 100 >= $0 }) == true { complete = true; break }
                if records.count >= 24 {
                    let hydrated = try await hydrate(insertion.compactMap { records[$0]?.card })
                    for card in hydrated { records[card.id]?.card = card }
                    if Self.uniqueWorks(hydrated).count >= 24 { break }
                }
            }
        } catch { try Task.checkCancellation(); complete = true }
        return .init(records: insertion.compactMap { records[$0] }, cutoff: complete ? 0 : oldest)
    }

    private func collect(library: JSONValue, order: EmbyHomeOrder, limit: Int) async throws -> Scan {
        let favorites = Self.favorite(library)
        let sort = order == .release ? "PremiereDate" : order == .rating ? "CommunityRating" : "DateCreated"
        var query = Self.images.merging(["Recursive": "true", "SortBy": sort + ",SortName", "SortOrder": "Descending", "Limit": "100", "Fields": Self.fields,
            "IncludeItemTypes": favorites ? "Series,Movie,Episode,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game" : Self.playable(library)]) { _, new in new }
        if order != .recent, !favorites {
            query["IncludeItemTypes"] = library["CollectionType"].string == "tvshows" ? "Series" : Self.types[library["CollectionType"].string ?? ""] ?? "Series,Movie,Video,MusicVideo,MusicAlbum,Book,AudioBook,PhotoAlbum,Game"
        }
        if favorites { query["IsFavorite"] = "true" } else { query["ParentId"] = library["Id"].string }
        var cards: [String: EmbyHomeCard] = [:], insertion: [String] = [], pages = Set<String>()
        var complete = favorites, oldest: TimeInterval = 0, page = 0
        while true {
            try Task.checkCancellation(); query["StartIndex"] = String(page * 100)
            let result = try await api.items(query: query)
            try Task.checkCancellation()
            let key = result.items.map { $0["Id"].string ?? "" }.joined(separator: ",")
            if !pages.insert(key).inserted { complete = true; break }
            for item in result.items {
                let card = Self.workCard(item), added = Self.stamp(item["DateCreated"].string)
                if added > 0, oldest == 0 || added < oldest { oldest = added }
                guard !card.id.isEmpty else { continue }
                if cards[card.id] == nil { insertion.append(card.id) }
                if cards[card.id] == nil || added > Self.stamp(cards[card.id]?.addedAt) { cards[card.id] = card }
            }
            if result.items.count < 100 || result.totalRecordCount.map({ (page + 1) * 100 >= $0 }) == true { complete = true; break }
            if !favorites, cards.count >= limit {
                let hydrated = try await hydrate(insertion.compactMap { cards[$0] })
                for card in hydrated { cards[card.id] = card }
                if Self.uniqueWorks(hydrated).count >= limit { break }
            }
            page += 1
        }
        var result = try await hydrate(insertion.compactMap { cards[$0] })
        if favorites, order == .recent {
            let indices = result.indices.filter { result[$0].item["Type"].string == "Series" }
            for start in stride(from: 0, to: indices.count, by: 4) {
                let batch = Array(indices[start..<min(start + 4, indices.count)]).map { ($0, result[$0]) }
                let updates = try await withThrowingTaskGroup(of: (Int, JSONValue?).self) { group in
                    for (index, card) in batch {
                        group.addTask {
                            try Task.checkCancellation()
                            let query = ["ParentId": card.id, "Recursive": "true", "IncludeItemTypes": "Episode", "SortBy": "DateCreated", "SortOrder": "Descending", "Limit": "1", "Fields": Self.fields, "EnableUserData": "true"]
                            do { return (index, try await api.items(query: query).items.first) }
                            catch { try Task.checkCancellation(); return (index, nil) }
                        }
                    }
                    var updates: [(Int, JSONValue?)] = []
                    for try await update in group { updates.append(update) }; return updates
                }
                for (index, latest) in updates { if let latest { result[index].addedAt = latest["DateCreated"].string ?? result[index].addedAt; result[index].latestEpisode = latest } }
            }
        }
        try Task.checkCancellation()
        return .init(cards: Self.sorted(result) { card in
            if order == .rating { return card.item["CommunityRating"].number ?? 0 }
            if order == .release {
                let year = card.item["ProductionYear"].number.map { String(Int(min(9999, max(0, $0)))) + "-01-01" }
                return Self.stamp(card.item["PremiereDate"].string ?? year)
            }
            return Self.stamp(card.addedAt)
        }, complete: complete, oldest: oldest)
    }

    private func hydrate(_ cards: [EmbyHomeCard]) async throws -> [EmbyHomeCard] {
        var cards = cards
        let indices = cards.indices.filter { cards[$0].needsHydration }
        for start in stride(from: 0, to: indices.count, by: 100) {
            try Task.checkCancellation()
            let batch = Array(indices[start..<min(start + 100, indices.count)])
            let query = Self.images.merging(["Ids": batch.map { cards[$0].id }.joined(separator: ","), "GroupByPresentationUniqueKey": "false", "Fields": Self.fields, "Limit": "100"]) { _, new in new }
            do {
                let items = try await api.items(query: query).items
                try Task.checkCancellation()
                for item in items { if let index = batch.first(where: { cards[$0].id == item["Id"].string }) { cards[index].item = item; cards[index].needsHydration = false } }
            } catch { try Task.checkCancellation() }
        }
        return cards
    }

    public func watchProgress(_ input: [EmbyHomeCard]) async throws -> [EmbyHomeCard] {
        var cards = input
        let indices = cards.indices.filter { cards[$0].item["Type"].string == "Series" && cards[$0].watchState.total == nil }
        for start in stride(from: 0, to: indices.count, by: 4) {
            let batch = Array(indices[start..<min(start + 4, indices.count)]).map { ($0, cards[$0]) }
            let updates = try await withThrowingTaskGroup(of: (Int, EmbyHomeWatchState?).self) { group in
                for (index, card) in batch {
                    group.addTask {
                        try Task.checkCancellation()
                        var query = Self.episodeQuery(parentID: card.id, limit: 0); query["EnableTotalRecordCount"] = "true"
                        let playedQuery = query.merging(["IsPlayed": "true"]) { _, new in new }
                        do {
                            async let all = api.items(query: query)
                            async let completed = api.items(query: playedQuery)
                            let (total, played) = try await (all.totalRecordCount, completed.totalRecordCount)
                            try Task.checkCancellation()
                            guard let total, let played, total >= 0, played >= 0, played <= total else { return (index, nil) }
                            return (index, .init(unwatched: total > 0 ? played < total : nil, played: played, total: total))
                        } catch { try Task.checkCancellation(); return (index, nil) }
                    }
                }
                var updates: [(Int, EmbyHomeWatchState?)] = []
                for try await update in group { updates.append(update) }; return updates
            }
            for (index, state) in updates { if let state { cards[index].watchState = state } }
        }
        try Task.checkCancellation(); return cards
    }

    private static func workCard(_ item: JSONValue) -> EmbyHomeCard {
        guard item["Type"].string == "Episode", let series = item["SeriesId"].string, !series.isEmpty else { return .init(item: item) }
        var work: [String: JSONValue] = ["Id": .string(series), "Type": .string("Series"), "Name": item["SeriesName"] == .null ? item["Name"] : item["SeriesName"], "ParentBackdropItemId": item["ParentBackdropItemId"], "ParentBackdropImageTags": item["ParentBackdropImageTags"]]
        if let tag = item["SeriesPrimaryImageTag"].string { work["ImageTags"] = .object(["Primary": .string(tag)]) }
        var card = EmbyHomeCard(item: .object(work), addedAt: item["DateCreated"].string, latestEpisode: item)
        card.needsHydration = true; return card
    }
    private static func arrived(_ card: inout EmbyHomeCard, episode: JSONValue?) {
        if let episode, episode["UserData"]["Played"].bool != true, stamp(episode["DateCreated"].string) > card.lastPlayed { card.newEpisode = episode }
    }
    private struct WorkKey: Hashable {
        let type: String
        let presentation: Bool
        let id: String
    }
    private static func uniqueWorks(_ cards: [EmbyHomeCard]) -> [EmbyHomeCard] {
        var indices: [WorkKey: Int] = [:], result: [EmbyHomeCard] = []
        for card in cards {
            let presentation = card.item["PresentationUniqueKey"].string ?? ""
            let key = WorkKey(type: card.item["Type"].string ?? "", presentation: !presentation.isEmpty, id: presentation.isEmpty ? card.id : presentation)
            guard let index = indices[key] else { indices[key] = result.count; result.append(card); continue }
            var prior = result[index]
            if card.lastPlayed > prior.lastPlayed { prior.lastPlayed = card.lastPlayed; prior.resumeItem = card.resumeItem }
            prior.hasPlaybackHistory = prior.hasPlaybackHistory || card.hasPlaybackHistory
            if stamp(card.addedAt) > stamp(prior.addedAt) { prior.addedAt = card.addedAt }
            if stamp(card.latestEpisode?["DateCreated"].string) > stamp(prior.latestEpisode?["DateCreated"].string) { prior.latestEpisode = card.latestEpisode }
            result[index] = prior
        }
        for index in result.indices where result[index].hasPlaybackHistory {
            result[index].newEpisode = nil
            let latest = result[index].latestEpisode
            arrived(&result[index], episode: latest)
        }
        return result
    }
    private static func episodeQuery(parentID: String, limit: Int) -> [String: String] {
        ["ParentId": parentID, "Recursive": "true", "IncludeItemTypes": "Episode", "IsMissing": "false", "IsVirtualUnaired": "false", "IsPlaceHolder": "false", "ExcludeLocationTypes": "Virtual", "Limit": String(limit)]
    }
    private static func withWatchState(_ cards: [EmbyHomeCard]) -> [EmbyHomeCard] {
        cards.map { value in var card = value; card.watchState.unwatched = card.item["UserData"]["Played"].bool.map { !$0 }; return card }
    }
    private static func sorted(_ cards: [EmbyHomeCard], score: (EmbyHomeCard) -> Double) -> [EmbyHomeCard] {
        cards.enumerated().sorted { lhs, rhs in
            let left = score(lhs.element), right = score(rhs.element)
            return left == right ? lhs.offset < rhs.offset : left > right
        }.map(\.element)
    }
    private static func stamp(_ text: String?) -> TimeInterval {
        guard let text, !text.isEmpty else { return 0 }
        let formatter = ISO8601DateFormatter()
        if let date = formatter.date(from: text) { return date.timeIntervalSince1970 }
        formatter.formatOptions.insert(.withFractionalSeconds)
        if let date = formatter.date(from: text) { return date.timeIntervalSince1970 }
        let simple = DateFormatter(); simple.locale = Locale(identifier: "en_US_POSIX"); simple.timeZone = TimeZone(secondsFromGMT: 0); simple.dateFormat = "yyyy-MM-dd"
        return simple.date(from: text)?.timeIntervalSince1970 ?? 0
    }
}
