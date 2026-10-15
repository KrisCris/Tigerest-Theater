// Compiled beside the production private TVCommentsModel by the dedicated runner.
import Foundation
import Testing

private final class TVCommentsFixture: URLProtocol {
    private static let lock = NSLock()
    private static var handler: ((URLRequest) throws -> (Int, JSONValue))?
    static func session(_ handler: @escaping (URLRequest) throws -> (Int, JSONValue)) -> URLSession {
        lock.withLock { Self.handler = handler }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Self.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let handler = Self.lock.withLock { Self.handler! }
            let (status, body) = try handler(request)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONEncoder().encode(body))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private actor TVCommentsMemoryStore: CommunityTokenStore {
    private var data: Data?
    init() throws {
        data = try JSONEncoder().encode(JSONValue(any: ["accessToken": "fixture-access", "refreshToken": "fixture-refresh", "tokenType": "Bearer",
            "expiresAt": "2099-01-01T00:00:00Z", "refreshExpiresAt": "2099-02-01T00:00:00Z", "author": ["id": "fixture", "name": "Fixture"], "kind": "password"]))
    }
    func read() -> Data? { data }
    func write(_ data: Data?) { self.data = data }
}

private final class TVCommentsResponses: @unchecked Sendable {
    private let lock = NSLock()
    private var paths: [String] = []
    var failFirstDiscovery = false
    var failFirstSeries = false
    static let trustedID = "62526c3bf747439c99327ddec5fed4a8"
    func count(_ path: String) -> Int { lock.withLock { paths.filter { $0 == path }.count } }
    func respond(_ request: URLRequest) throws -> (Int, JSONValue) {
        let path = request.url!.path
        let count = lock.withLock { paths.append(path); return paths.filter { $0 == path }.count }
        if path == "/community/v2/capabilities" {
            if failFirstDiscovery && count == 1 { throw URLError(.notConnectedToInternet) }
            return (200, try JSONValue(any: ["data": ["enabled": true, "auth": ["password", "emby-exchange"], "mediaIdentity": "tmdb-aired", "embyExchangeServerId": Self.trustedID]]))
        }
        if path == "/Users/user/Items/series" {
            if failFirstSeries && count == 1 { throw URLError(.networkConnectionLost) }
            return (200, try JSONValue(any: ["Id": "series", "Type": "Series", "ProviderIds": ["Tmdb": "123"], "DisplayOrder": "Aired"]))
        }
        if path.hasSuffix("/auth/emby") {
            return (200, try JSONValue(any: ["data": ["accessToken": "fixture-access", "refreshToken": "fixture-refresh", "tokenType": "Bearer",
                "expiresAt": "2099-01-01T00:00:00Z", "refreshExpiresAt": "2099-02-01T00:00:00Z", "author": ["id": "fixture", "name": "Fixture"]]]))
        }
        if path.hasSuffix("/me") { return (200, try JSONValue(any: ["data": ["author": ["id": "fixture", "name": "Fixture"]]])) }
        if path.hasSuffix("/topics/resolve") { return (200, try JSONValue(any: ["data": ["id": "topic", "title": "Fixture topic"]])) }
        if path.hasSuffix("/topics/topic/comments") {
            let paged = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems?.contains { $0.name == "cursor" } == true
            return (200, try JSONValue(any: ["data": ["items": [["id": paged ? "second" : "first", "body": "Fixture comment", "state": "visible"]], "nextCursor": paged ? NSNull() : "next"]]))
        }
        Issue.record("Unexpected fixture route: \(path)")
        throw URLError(.unsupportedURL)
    }
}

@MainActor @Suite(.serialized) struct TVCommentsModelTests {
    private func model(_ fixture: TVCommentsResponses, trusted: Bool = true, item suppliedItem: JSONValue? = nil) throws -> (TVCommentsModel, URLSession) {
        let transport = TVCommentsFixture.session { try fixture.respond($0) }
        let session = EmbySession(serverURL: "https://comments-fixture.invalid", userID: "user", accessToken: "fixture-emby", deviceID: "fixture-tv", serverID: trusted ? TVCommentsResponses.trustedID : "foreign")
        let emby = try EmbyClient(session: session, urlSession: transport)
        let community = CommunityClient(emby: session, urlSession: transport, store: try TVCommentsMemoryStore())
        let item = try suppliedItem ?? JSONValue(any: ["Id": "episode", "Type": "Episode", "SeriesId": "series", "ParentIndexNumber": 1, "IndexNumber": 2])
        return (TVCommentsModel(item: item, client: emby, session: session, community: community), transport)
    }
    private func settled(_ model: TVCommentsModel) async throws {
        for _ in 0..<200 {
            if !model.busy { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        Issue.record("Comments operation did not finish")
    }

    @Test func refreshRecoversDiscoveryAndPrivateDefault() async throws {
        let fixture = TVCommentsResponses(); fixture.failFirstDiscovery = true
        let (model, transport) = try model(fixture)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        #expect(!model.hasLoadedComments)
        #expect(!model.privateAvailable)
        model.refresh(); try await settled(model)
        #expect(model.privateAvailable)
        #expect(model.channel == .privateServer)
        #expect(model.hasLoadedComments)
        #expect(model.comments.first?["id"].string == "first")
        #expect(fixture.count("/community/v2/capabilities") == 2)
        #expect(fixture.count("/community/v1/topics/topic/comments") == 1)
    }

    @Test func refreshRetriesFailedSeriesForPublicEpisode() async throws {
        let fixture = TVCommentsResponses(); fixture.failFirstSeries = true
        let (model, transport) = try model(fixture, trusted: false)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        #expect(!model.hasLoadedComments)
        #expect(model.comments.isEmpty)
        model.draft = "Keep my public draft"
        model.reply = .object(["id": .string("reply-target")])
        model.refresh(); try await settled(model)
        #expect(model.hasLoadedComments)
        #expect(model.channel == .publicCommunity)
        #expect(model.scope == "episode")
        #expect(model.draft == "Keep my public draft")
        #expect(model.reply?["id"].string == "reply-target")
        #expect(fixture.count("/Users/user/Items/series") == 2)
        #expect(fixture.count("/community/v2/topics/topic/comments") == 1)
    }

    @Test func refreshKeepsSelectedChannelDraftsAndPagination() async throws {
        let fixture = TVCommentsResponses()
        let (model, transport) = try model(fixture)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        model.draft = "Private draft"
        model.select(channel: .publicCommunity, scope: "work"); try await settled(model)
        model.draft = "Public work draft"
        model.reply = .object(["id": .string("public-reply")])
        model.more(); try await settled(model)
        #expect(model.comments.compactMap { $0["id"].string } == ["first", "second"])
        #expect(model.nextCursor == nil)
        model.refresh(); try await settled(model)
        #expect(model.channel == .publicCommunity)
        #expect(model.scope == "work")
        #expect(model.draft == "Public work draft")
        #expect(model.reply?["id"].string == "public-reply")
        #expect(model.comments.compactMap { $0["id"].string } == ["first"])
        #expect(model.nextCursor == "next")
        model.select(channel: .privateServer, scope: "episode"); try await settled(model)
        #expect(model.draft == "Private draft")
        model.select(channel: .publicCommunity, scope: "work"); try await settled(model)
        #expect(model.draft == "Public work draft")
        #expect(model.reply?["id"].string == "public-reply")
        #expect(fixture.count("/community/v2/capabilities") == 1)
        #expect(fixture.count("/Users/user/Items/series") == 1)
    }

    @Test func recoveredDiscoveryKeepsExplicitPublicSelection() async throws {
        let fixture = TVCommentsResponses(); fixture.failFirstDiscovery = true
        let (model, transport) = try model(fixture)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        model.draft = "Public draft before discovery recovers"
        model.select(channel: .publicCommunity); try await settled(model)
        #expect(model.privateAvailable)
        #expect(model.hasLoadedComments)
        #expect(model.channel == .publicCommunity)
        #expect(model.draft == "Public draft before discovery recovers")
    }

    @Test func recoveredPrivateDefaultPreservesPublicDraftInItsChannel() async throws {
        let fixture = TVCommentsResponses(); fixture.failFirstDiscovery = true
        let (model, transport) = try model(fixture)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        model.draft = "Public draft before discovery recovers"
        model.refresh(); try await settled(model)
        #expect(model.channel == .privateServer)
        #expect(model.draft.isEmpty)
        model.select(channel: .publicCommunity); try await settled(model)
        #expect(model.draft == "Public draft before discovery recovers")
    }

    @Test func inlineCommentsRecoverWhenDetailAddsSeriesMetadata() async throws {
        let fixture = TVCommentsResponses()
        let partial = try JSONValue(any: ["Id": "episode", "Type": "Episode", "ParentIndexNumber": 1, "IndexNumber": 2])
        let (model, transport) = try model(fixture, trusted: false, item: partial)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        #expect(!model.hasLoadedComments)
        model.draft = "Draft written while detail is loading"
        var complete = partial.object!; complete["SeriesId"] = .string("series")
        model.updateItem(.object(complete)); try await settled(model)
        #expect(model.hasLoadedComments)
        #expect(model.item["SeriesId"].string == "series")
        #expect(model.draft == "Draft written while detail is loading")
        #expect(model.channel == .publicCommunity)
        #expect(fixture.count("/Users/user/Items/series") == 1)
    }

    @Test func metadataRefreshDoesNotReplaceTheItemOwningTheDraft() async throws {
        let fixture = TVCommentsResponses()
        let (model, transport) = try model(fixture)
        defer { model.close(); transport.invalidateAndCancel() }
        model.start(); try await settled(model)
        model.draft = "Episode A draft"
        model.updateItem(try JSONValue(any: ["Id": "different-episode", "Type": "Episode", "SeriesId": "series"]))
        try await settled(model)
        #expect(model.item["Id"].string == "episode")
        #expect(model.draft == "Episode A draft")
        #expect(fixture.count("/community/v1/topics/topic/comments") == 1)
    }
}
