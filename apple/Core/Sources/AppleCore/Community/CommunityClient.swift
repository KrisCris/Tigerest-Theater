import Foundation

public enum CommunityChannel: String, Sendable, CaseIterable { case privateServer, publicCommunity }
public struct CommunityError: Error, LocalizedError, Sendable {
    public let code: String
    public let status: Int
    public let retryAfter: Double
    public init(_ code: String, status: Int = 0, retryAfter: Double = 0) { self.code = code; self.status = status; self.retryAfter = retryAfter }
    public var errorDescription: String? {
        if status == 429 { return "操作过于频繁，请等待 \(Int(retryAfter)) 秒后重试。" }
        return ["LOGIN_REQUIRED":"请先登录评论账号。", "AUTH_REQUIRED":"请重新登录评论账号。", "AUTH_INVALID":"评论登录已失效，请重新登录。",
                "SERVER_NOT_ALLOWED":"此服务器未开放专属评论，请使用公共评论。", "MEDIA_ORDER_UNSUPPORTED":"此媒体的集序不明确，暂不支持公共单集评论。",
                "MEDIA_IDENTITY_UNAVAILABLE":"缺少可靠的作品 TMDB 信息，暂不支持公共评论。", "USER_MUTED":"你已被禁言，暂时无法发言。",
                "NOT_FOUND":"评论不可见或已删除，请刷新。", "TARGET_DELETED":"回复目标已删除，请重新选择。", "INVALID_REQUEST":"内容或媒体信息无效，请检查后重试。",
                "AUTH_UNAVAILABLE":"评论身份服务暂不可用，请稍后重试。", "NETWORK_UNAVAILABLE":"评论服务暂不可用，请稍后重试。",
                "PASSWORD_LOGIN_UNAVAILABLE":"此评论账号使用 Emby 登录。", "REGISTRATION_DISABLED":"评论账号注册暂未开放。", "USERNAME_TAKEN":"评论用户名已被使用。"] [code] ?? "评论操作失败，请稍后重试。"
    }
}
public struct CommunityCredentials: Codable, Sendable {
    public let accessToken: String
    public let refreshToken: String
    public let tokenType: String
    public let expiresAt: String
    public let refreshExpiresAt: String
    public let author: JSONValue
    public var kind: String = "password"
}
public protocol CommunityTokenStore: Sendable {
    func read() async throws -> Data?
    func write(_ data: Data?) async throws
}
private final class CommentNoRedirect: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}

/// The same private/public boundary used by communityPlugin.js. A foreign Emby
/// token never enters public requests, including public login and topic lookup.
public actor CommunityClient {
    private let emby: EmbySession
    private let serverID: String
    private let configuration: URLSessionConfiguration
    private let store: (any CommunityTokenStore)?
    private var caps: JSONValue = .null
    private var capsUntil = Date.distantPast
    private var tokens: CommunityCredentials?
    private var loaded = false
    private var renewalFailed = false
    private var authFlight: Task<CommunityCredentials, Error>?
    private var authFlightID = UUID()
    private var epoch: UInt64 = 0
    private var storageFlight: Task<Void, Error>?
    private var pendingSends: [String: JSONValue] = [:]
    private var cooldown = Date.distantPast

    public init(emby: EmbySession, serverID: String? = nil, urlSession: URLSession = .shared, store: (any CommunityTokenStore)? = nil) {
        self.emby = emby; self.serverID = serverID ?? emby.serverID ?? ""
        self.configuration = urlSession.configuration; self.store = store
    }
    public func discover() async throws -> JSONValue {
        if Date() < capsUntil { return caps }
        let value = try await raw("/capabilities")
        guard value["enabled"].bool == true, value["auth"].array != nil, value["mediaIdentity"].string == "tmdb-aired" else { throw CommunityError("NETWORK_UNAVAILABLE") }
        caps = value; capsUntil = Date().addingTimeInterval(300); return value
    }
    private var trusted: Bool {
        !CommunityPolicy.guid(serverID).isEmpty && CommunityPolicy.guid(serverID) == CommunityPolicy.guid(caps["embyExchangeServerId"].string ?? "") &&
        caps["enabled"].bool == true && caps["auth"].array?.contains(.string("emby-exchange")) == true
    }
    public func privateAvailable() async throws -> Bool { _ = try await discover(); return trusted }
    public func mappingHeaders() async throws -> [String: String] {
        _ = try await discover(); return trusted ? embyHeaders : [:]
    }
    private var embyHeaders: [String: String] {
        guard [emby.accessToken, emby.userID, serverID].allSatisfy(CommunityPolicy.safe) else { return [:] }
        return ["X-Emby-Token": emby.accessToken, "X-Emby-Server-Id": serverID, "X-Emby-User-Id": emby.userID]
    }
    public func me(channel: CommunityChannel) async throws -> JSONValue { try await request("/me", channel: channel) }
    public func resolve(item: JSONValue, series: JSONValue = .null, scope: String, channel: CommunityChannel) async throws -> JSONValue {
        guard ["work", "episode"].contains(scope), let id = item["Id"].string else { throw CommunityError("INVALID_REQUEST") }
        let body: JSONValue = channel == .privateServer ? .object(["itemId": .string(try Self.identifier(id)), "scope": .string(scope)]) : try Self.mediaIdentity(item: item, series: series, scope: scope)
        return try await request("/topics/resolve", method: "POST", body: body, channel: channel)
    }
    public func comments(topicID: String, itemID: String, channel: CommunityChannel, cursor: String? = nil) async throws -> JSONValue {
        try await request("/topics/\(Self.identifier(topicID))/comments" + Self.pageQuery(cursor, limit: 10), itemID: itemID, channel: channel)
    }
    public func replies(rootID: String, itemID: String, channel: CommunityChannel, cursor: String? = nil) async throws -> JSONValue {
        try await request("/comments/\(Self.identifier(rootID))/replies" + Self.pageQuery(cursor, limit: 20), itemID: itemID, channel: channel)
    }
    public func send(topicID: String, itemID: String, channel: CommunityChannel, text: String, reply: JSONValue? = nil) async throws -> JSONValue {
        let generation = epoch
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.unicodeScalars.count <= 2000 else { throw CommunityError("INVALID_REQUEST") }
        let wait = cooldown.timeIntervalSinceNow
        guard wait <= 0 else { throw CommunityError("RATE_LIMITED", status: 429, retryAfter: ceil(wait)) }
        let path: String
        var body: [String: JSONValue] = ["body": .string(text)]
        if let reply {
            guard let id = reply["id"].string else { throw CommunityError("INVALID_REQUEST") }
            path = "/comments/\(try Self.identifier(reply["rootId"].string ?? id))/replies"
            body["replyToId"] = .string(try Self.identifier(id))
        } else { path = "/topics/\(try Self.identifier(topicID))/comments" }
        let key = channel.rawValue + "|" + itemID + "|" + path + "|" + (body["replyToId"]?.string ?? "") + "|" + text
        if pendingSends[key] == nil { body["clientRequestId"] = .string(UUID().uuidString.lowercased()); pendingSends[key] = .object(body) }
        let attempt = pendingSends[key]!
        let result = try await request(path, method: "POST", body: attempt, itemID: itemID, channel: channel)
        try ensure(generation)
        if pendingSends[key] == attempt { pendingSends[key] = nil }
        cooldown = max(cooldown, Date().addingTimeInterval(3)); return result
    }
    public func remove(commentID: String, itemID: String, channel: CommunityChannel) async throws {
        _ = try await request("/comments/\(Self.identifier(commentID))", method: "DELETE", itemID: itemID, channel: channel)
    }
    public func login(username: String, password: String) async throws {
        epoch &+= 1; let generation = epoch
        authFlight?.cancel(); authFlight = nil; tokens = nil; pendingSends = [:]; cooldown = .distantPast
        try await persist(nil)
        _ = try await discover()
        try ensure(generation)
        guard !trusted, caps["auth"].array?.contains(.string("password")) == true else { throw CommunityError("PASSWORD_LOGIN_UNAVAILABLE") }
        guard !username.isEmpty, username.utf8.count <= 128, password.utf8.count <= 1024 else { throw CommunityError("INVALID_REQUEST") }
        let value = try await raw("/auth/login", method: "POST", body: .object(["username": .string(username), "password": .string(password)]))
        try await save(value, kind: "password", generation: generation); loaded = true; renewalFailed = false
    }
    public func logout() async {
        epoch &+= 1
        let old = tokens; tokens = nil; loaded = true; authFlight?.cancel(); authFlight = nil; pendingSends = [:]; cooldown = .distantPast
        try? await persist(nil)
        if let old { _ = try? await raw("/auth/logout", method: "POST", body: .object([:]), headers: ["Authorization": "Bearer " + old.accessToken]) }
    }
    private func request(_ path: String, method: String = "GET", body: JSONValue? = nil, itemID: String? = nil, channel: CommunityChannel) async throws -> JSONValue {
        let generation = epoch
        let item = try itemID.map(Self.identifier)
        _ = try await discover()
        try ensure(generation)
        var authorizingToken: String?
        do {
            if channel == .privateServer {
                guard trusted, !embyHeaders.isEmpty else { throw CommunityError("SERVER_NOT_ALLOWED") }
                var headers = embyHeaders; if let item { headers["X-Tigerest-Item-Id"] = item }
                let value = try await raw(path, method: method, body: body, headers: headers, privateAPI: true)
                try ensure(generation); return value
            }
            var record = try await ready()
            try ensure(generation); authorizingToken = record.accessToken
            do {
                let value = try await raw(path, method: method, body: body, headers: ["Authorization": "Bearer " + record.accessToken])
                try ensure(generation); return value
            }
            catch let error as CommunityError where error.status == 401 {
                try ensure(generation)
                // A concurrent request may have already rotated the rejected token.
                if let current = tokens, current.accessToken != record.accessToken { record = current }
                else { record = try await ready(force: true) }
                try ensure(generation); authorizingToken = record.accessToken
                let value = try await raw(path, method: method, body: body, headers: ["Authorization": "Bearer " + record.accessToken])
                try ensure(generation); return value
            }
        } catch let error as CommunityError {
            try ensure(generation)
            if error.status == 429 { cooldown = max(cooldown, Date().addingTimeInterval(error.retryAfter)) }
            if error.status == 401, channel == .publicCommunity,
               authorizingToken == nil || tokens?.accessToken == authorizingToken {
                tokens = nil; try? await persist(nil, generation: generation)
                try ensure(generation)
            }
            throw error
        }
    }
    private func ready(force: Bool = false) async throws -> CommunityCredentials {
        if let flight = authFlight { return try await flight.value }
        let id = UUID(); authFlightID = id
        let flight = Task { try await self.prepare(force: force) }; authFlight = flight
        defer { if authFlightID == id { authFlight = nil } }; return try await flight.value
    }
    private func prepare(force: Bool) async throws -> CommunityCredentials {
        let generation = epoch
        if !loaded {
            loaded = true
            _ = await storageFlight?.result
            try ensure(generation)
            let data = try? await store?.read()
            try ensure(generation)
            if let data, let saved = try? JSONDecoder().decode(CommunityCredentials.self, from: data), Self.valid(saved), saved.kind == (trusted ? "emby" : "password") { tokens = saved }
        }
        if let tokens, !force, Self.date(tokens.expiresAt) > Date().addingTimeInterval(30) { return tokens }
        if trusted {
            try await save(raw("/auth/emby", method: "POST", body: .object([:]), headers: embyHeaders), kind: "emby", generation: generation)
        } else {
            guard !renewalFailed, let old = tokens, Self.date(old.refreshExpiresAt) > Date() else { throw CommunityError("LOGIN_REQUIRED") }
            // Persist the tombstone before sending a rotating refresh token.
            tokens = nil
            do { try await persist(nil, generation: generation) } catch { try ensure(generation); throw CommunityError("AUTH_REQUIRED") }
            do { try await save(raw("/auth/refresh", method: "POST", body: .object(["refreshToken": .string(old.refreshToken)])), kind: "password", generation: generation) }
            catch { try ensure(generation); renewalFailed = true; throw error }
        }
        guard let tokens else { throw CommunityError("AUTH_INVALID") }; return tokens
    }
    private func save(_ value: JSONValue, kind: String, generation: UInt64) async throws {
        try ensure(generation)
        guard var fields = value.object else { throw CommunityError("AUTH_INVALID") }
        fields["kind"] = .string(kind)
        let data = try JSONEncoder().encode(JSONValue.object(fields))
        guard var record = try? JSONDecoder().decode(CommunityCredentials.self, from: data), Self.valid(record) else { throw CommunityError("AUTH_INVALID") }
        record.kind = kind
        try? await persist(JSONEncoder().encode(record), generation: generation) // Secure-store failure remains memory-only.
        try ensure(generation); tokens = record
    }
    private func ensure(_ generation: UInt64) throws {
        guard generation == epoch, !Task.isCancelled else { throw CancellationError() }
    }
    private func persist(_ data: Data?, generation: UInt64? = nil) async throws {
        guard let store else { return }
        let prior = storageFlight
        let next = Task {
            _ = await prior?.result
            if let generation { try self.ensure(generation) }
            try await store.write(data)
        }
        storageFlight = next; try await next.value
    }
    private func raw(_ path: String, method: String = "GET", body: JSONValue? = nil, headers: [String: String] = [:], privateAPI: Bool = false) async throws -> JSONValue {
        let generation = epoch
        guard path.hasPrefix("/"), !path.contains(".."), !path.contains("//"), path.utf8.count <= 4096,
              headers.values.allSatisfy({ !$0.contains("\r") && !$0.contains("\n") }) else { throw CommunityError("INVALID_REQUEST") }
        let hostname = privateAPI && URL(string: emby.serverURL)?.host == "192.168.5.150" ? "192.168.5.150" : "nas.tigerest.top"
        guard let url = URL(string: "http://\(hostname):18443/community/\(privateAPI ? "v1" : "v2")" + path) else { throw CommunityError("INVALID_REQUEST") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        guard (request.httpBody?.count ?? 0) <= 16384 else { throw CommunityError("INVALID_REQUEST") }
        let config = configuration.copy() as! URLSessionConfiguration
        config.httpCookieStorage = nil; config.urlCredentialStorage = nil; config.timeoutIntervalForResource = 35
        let http = URLSession(configuration: config, delegate: CommentNoRedirect(), delegateQueue: nil)
        defer { http.invalidateAndCancel() }
        do {
            let (bytes, response) = try await http.bytes(for: request)
            guard let response = response as? HTTPURLResponse, response.expectedContentLength <= 2_097_152, !(300..<400).contains(response.statusCode) else { throw CommunityError("NETWORK_UNAVAILABLE") }
            var data = Data()
            for try await byte in bytes { guard data.count < 2_097_152 else { throw CommunityError("NETWORK_UNAVAILABLE") }; data.append(byte) }
            try ensure(generation)
            let value = try JSONDecoder().decode(JSONValue.self, from: data)
            guard (200..<300).contains(response.statusCode) else {
                throw CommunityError(value["error"]["code"].string ?? "NETWORK_UNAVAILABLE", status: response.statusCode,
                                     retryAfter: min(86400, max(1, Double(response.value(forHTTPHeaderField: "Retry-After") ?? "") ?? 3)))
            }
            guard value["data"] != .null else { throw CommunityError("NETWORK_UNAVAILABLE") }; return value["data"]
        } catch {
            try ensure(generation)
            if error is CancellationError { throw CancellationError() }
            if let error = error as? CommunityError { throw error }
            throw CommunityError("NETWORK_UNAVAILABLE")
        }
    }
    private static func identifier(_ text: String) throws -> String {
        guard text.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { throw CommunityError("INVALID_REQUEST") }; return text
    }
    private static func pageQuery(_ cursor: String?, limit: Int) throws -> String {
        guard (cursor?.utf8.count ?? 0) <= 2048 else { throw CommunityError("INVALID_REQUEST") }
        var query = URLComponents(); query.queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }; return "?" + (query.percentEncodedQuery ?? "")
    }
    private static func date(_ value: String) -> Date {
        let formatter = ISO8601DateFormatter(); if let date = formatter.date(from: value) { return date }
        formatter.formatOptions.insert(.withFractionalSeconds); return formatter.date(from: value) ?? .distantPast
    }
    private static func valid(_ value: CommunityCredentials) -> Bool {
        value.tokenType == "Bearer" && [value.accessToken, value.refreshToken].allSatisfy { $0.range(of: "^[A-Za-z0-9._~+/-]{1,4000}={0,2}$", options: .regularExpression) != nil } &&
        date(value.expiresAt) != .distantPast && date(value.refreshExpiresAt) != .distantPast && value.author["id"].string != nil && value.author["name"].string != nil
    }
    public nonisolated static func mediaIdentity(item: JSONValue, series: JSONValue, scope: String) throws -> JSONValue {
        let work = ["Movie", "Series"].contains(item["Type"].string ?? "") ? item : series
        let tmdb = work["ProviderIds"]["Tmdb"].string ?? work["ProviderIds"]["tmdb"].string ?? ""
        guard tmdb.range(of: "^[1-9][0-9]{0,17}$", options: .regularExpression) != nil else { throw CommunityError("MEDIA_IDENTITY_UNAVAILABLE") }
        var body: [String: JSONValue] = ["mediaType": .string(item["Type"].string == "Movie" ? "movie" : "tv"), "tmdbId": .string(tmdb), "scope": .string(scope)]
        if scope == "episode" {
            let order = item["DisplayOrder"].string ?? series["DisplayOrder"].string
            guard item["Type"].string == "Episode", ["aired", "Aired"].contains(order ?? ""),
                  let season = item["ParentIndexNumber"].number, season.isFinite, season.rounded() == season, (0...1000).contains(season),
                  let episode = item["IndexNumber"].number, episode.isFinite, episode.rounded() == episode, (1...10000).contains(episode),
                  item["IndexNumberEnd"] == .null || item["IndexNumberEnd"].number == episode else { throw CommunityError("MEDIA_ORDER_UNSUPPORTED") }
            body["season"] = .number(season); body["episode"] = .number(episode); body["order"] = .string("aired")
        } else if scope != "work" { throw CommunityError("INVALID_REQUEST") }
        return .object(body)
    }
}
