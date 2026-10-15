import Foundation
import Testing
@testable import AppleCore

private final class EmbyFixtureProtocol: URLProtocol, @unchecked Sendable {
    struct Reply { var status = 200; var data: Data; var headers: [String: String] = [:] }
    private static let lock = NSLock()
    nonisolated(unsafe) private static var handler: (@Sendable (URLRequest) throws -> Reply)?
    static func install(_ handler: @escaping @Sendable (URLRequest) throws -> Reply) -> URLSession {
        lock.withLock { self.handler = handler }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EmbyFixtureProtocol.self]
        return URLSession(configuration: configuration)
    }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let handler = Self.lock.withLock { Self.handler }
            let reply = try handler!(request)
            let response = HTTPURLResponse(url: request.url!, statusCode: reply.status, httpVersion: "HTTP/1.1", headerFields: reply.headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: reply.data)
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private func reply(_ json: String, status: Int = 200) -> EmbyFixtureProtocol.Reply {
    .init(status: status, data: Data(json.utf8))
}
private func body(_ request: URLRequest) throws -> JSONValue {
    var data = request.httpBody ?? Data()
    if data.isEmpty, let stream = request.httpBodyStream {
        stream.open(); defer { stream.close() }
        var buffer = [UInt8](repeating: 0, count: 4096)
        while true {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(contentsOf: buffer.prefix(count))
        }
    }
    return try JSONDecoder().decode(JSONValue.self, from: data)
}
private func query(_ url: URL) -> [String: String] {
    Dictionary((URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { _, rhs in rhs })
}
private func mediaItem() throws -> JSONValue {
    try JSONValue(any: ["Id": "episode1", "Type": "Episode", "Name": "Test", "RunTimeTicks": 72000000000,
                       "UserData": ["PlaybackPositionTicks": 125000000]])
}
private func session() -> EmbySession {
    EmbySession(serverURL: "https://emby.test/proxy/emby/", userID: "user1", accessToken: "private-token", deviceID: "tv-device")
}

@Suite(.serialized) struct EmbyClientTests {
    @Test func loginPreservesProxyPathAndSendsPasswordOnlyInJSON() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.absoluteString == "https://emby.test/proxy/emby/Users/AuthenticateByName")
            #expect(request.httpMethod == "POST")
            #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
            #expect(request.value(forHTTPHeaderField: "X-Emby-Authorization")?.contains("DeviceId=\"tv-device\"") == true)
            #expect(request.value(forHTTPHeaderField: "X-Emby-Token") == nil)
            let json = try body(request)
            #expect(json["Username"].string == "alice")
            #expect(json["Pw"].string == "password with spaces")
            #expect(request.timeoutInterval <= 30)
            return reply(#"{"User":{"Id":"user1"},"AccessToken":"private-token"}"#)
        }
        defer { transport.invalidateAndCancel() }
        let authenticated = try await EmbyClient.login(server: " https://emby.test/proxy/emby ", username: "alice", password: "password with spaces", deviceID: "tv-device", urlSession: transport)
        #expect(authenticated.serverURL == "https://emby.test/proxy/emby/")
        #expect(authenticated.userID == "user1")
        #expect(authenticated.accessToken == "private-token")
        #expect(authenticated.deviceID == "tv-device")
        let encoded = try JSONEncoder().encode(authenticated)
        #expect(!String(decoding: encoded, as: UTF8.self).contains("password with spaces"))
    }

    @Test func publicInfoIsUnauthenticatedAndReturnsServerName() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.path == "/proxy/emby/System/Info/Public")
            #expect(request.value(forHTTPHeaderField: "X-Emby-Token") == nil)
            return reply(#"{"ServerName":"Living Room","Version":"4.9.0.0","Id":"server"}"#)
        }
        defer { transport.invalidateAndCancel() }
        #expect(try await EmbyClient.publicInfo(server: session().serverURL, urlSession: transport) == "Living Room")
    }

    @Test func authenticationRejectsHTTPFailureAndIncompleteSession() async throws {
        for (status, json) in [(401, #"{"AccessToken":"do-not-display","User":{"Id":"user1"}}"#), (200, #"{"User":{"Id":"user1"}}"#)] {
            let transport = EmbyFixtureProtocol.install { _ in reply(json, status: status) }
            defer { transport.invalidateAndCancel() }
            await #expect(throws: (any Error).self) {
                try await EmbyClient.login(server: session().serverURL, username: "alice", password: "secret", deviceID: "tv-device", urlSession: transport)
            }
        }
    }

    @Test func browsingUsesAuthenticatedBoundedQueriesAndSeasonEpisodeRoutes() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            let url = try #require(request.url)
            let values = query(url)
            #expect(request.value(forHTTPHeaderField: "X-Emby-Token") == "private-token")
            #expect(values["api_key"] == nil)
            #expect(Int(values["Limit"] ?? "0")! > 0)
            #expect(Int(values["Limit"] ?? "10000")! <= 200)
            switch url.path {
            case "/proxy/emby/Users/user1/Views": break
            case "/proxy/emby/Users/user1/Items/Resume":
                #expect(values["MediaTypes"] == "Video")
                #expect(values["Limit"] == "20")
            case "/proxy/emby/Shows/series1/Seasons":
                #expect(values["UserId"] == "user1")
                #expect(values["SortBy"] == "IndexNumber,SortName")
            case "/proxy/emby/Shows/series1/Episodes":
                #expect(values["SeasonId"] == "season2")
                #expect(values["UserId"] == "user1")
            case "/proxy/emby/Users/user1/Items":
                #expect(values["ParentId"] == "folder1")
                #expect(values["Recursive"] == "false")
            default: Issue.record("Unexpected browse route: \(url.path)")
            }
            return reply(#"{"Items":[{"Id":"one","Type":"Episode","IndexNumber":2}],"TotalRecordCount":1}"#)
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        #expect(try await client.libraries().count == 1)
        #expect(try await client.resumeItems().count == 1)
        #expect(try await client.children(of: JSONValue(any: ["Id": "series1", "Type": "Series"])).count == 1)
        #expect(try await client.children(of: JSONValue(any: ["Id": "season2", "SeriesId": "series1", "Type": "Season"])).count == 1)
        #expect(try await client.children(of: JSONValue(any: ["Id": "folder1", "Type": "Folder"])).count == 1)
    }

    @Test func childPaginationRetainsOffsetAndCapsOversizedServerResponses() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            let values = query(request.url!)
            #expect(values["StartIndex"] == "160")
            #expect(values["Limit"] == "100")
            return .init(data: try JSONSerialization.data(withJSONObject: ["Items": (0..<150).map { ["Id": String($0)] }, "TotalRecordCount": 1000]))
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        let result = try await client.children(of: JSONValue(any: ["Id": "library", "Type": "Folder"]), startIndex: 160, limit: 10000)
        #expect(result.count == 100)
        #expect(result.last?["Id"].string == "99")
    }

    @Test func resumeNamesPlayableVideoTypesForEmby48Through410() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.path == "/proxy/emby/Users/user1/Items/Resume")
            let values = query(request.url!)
            #expect(values["MediaTypes"] == "Video")
            // These server versions return no resumable records without named
            // types, even when MediaTypes already specifies Video.
            let included = Set((values["IncludeItemTypes"] ?? "").split(separator: ",").map(String.init))
            #expect(included == ["Episode", "Movie", "Video", "MusicVideo"])
            let records = ["Episode", "Movie", "Video", "MusicVideo"].filter(included.contains).map { ["Id": $0, "Type": $0] }
            return .init(data: try JSONSerialization.data(withJSONObject: ["Items": records, "TotalRecordCount": records.count]))
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        let items = try await client.resumeItems()
        #expect(items.map { $0["Type"].string } == ["Episode", "Movie", "Video", "MusicVideo"])
    }

    @Test func seasonWithoutSeriesIDStillQueriesOnlyItsEpisodes() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.path == "/proxy/emby/Users/user1/Items")
            let values = query(request.url!)
            #expect(values["ParentId"] == "season1")
            #expect(values["IncludeItemTypes"] == "Episode")
            #expect(values["SortBy"] == "ParentIndexNumber,IndexNumber,SortName")
            #expect(values["StartIndex"] == "0")
            #expect(values["Limit"] == "80")
            return reply(#"{"Items":[],"TotalRecordCount":0}"#)
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        #expect(try await client.children(of: JSONValue(any: ["Id": "season1", "Type": "Season"])).isEmpty)
    }

    @Test func itemAndImagesPreserveProxyPathAndRejectPathInjection() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.path == "/proxy/emby/Users/user1/Items/episode1")
            return reply(#"{"Id":"episode1","Name":"Episode"}"#)
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        #expect(try await client.item(id: "episode1")["Name"].string == "Episode")
        let image = try #require(client.imageURL(for: mediaItem(), type: "Primary", maxWidth: 400))
        #expect(image.path == "/proxy/emby/Items/episode1/Images/Primary")
        #expect(query(image)["api_key"] == "private-token")
        #expect(query(image)["MaxWidth"] == "400")
        await #expect(throws: (any Error).self) { try await client.item(id: "../Users") }
        #expect(client.imageURL(for: try JSONValue(any: ["Id": "../Users"]), type: "Primary", maxWidth: 400) == nil)
    }

    @Test func playbackNegotiatesMPVDirectPlayAndResumesWithSafeFallback() async throws {
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.url?.path == "/proxy/emby/Items/episode1/PlaybackInfo")
            #expect(request.httpMethod == "POST")
            let json = try body(request)
            #expect(json["UserId"].string == "user1")
            #expect(json["StartTimeTicks"].number == 125000000)
            #expect(json["EnableDirectPlay"].bool == true)
            #expect(json["EnableTranscoding"].bool == false)
            #expect(json["DeviceProfile"]["DirectPlayProfiles"].array?.contains { $0["Type"].string == "Video" } == true)
            return reply(#"{"PlaySessionId":"play1","MediaSources":[{"Id":"source1","Path":"/Volumes/private/movie.mkv","Protocol":"File","Container":"mkv","SupportsDirectPlay":true,"SupportsDirectStream":true}]}"#)
        }
        defer { transport.invalidateAndCancel() }
        let playback = try await EmbyClient(session: session(), urlSession: transport).playback(item: mediaItem())
        #expect(playback.url.path == "/proxy/emby/Videos/episode1/stream")
        #expect(query(playback.url)["Static"] == "true")
        #expect(query(playback.url)["MediaSourceId"] == "source1")
        #expect(query(playback.url)["api_key"] == "private-token")
        #expect(playback.headers.isEmpty)
        #expect(playback.startSeconds == 12.5)
        #expect(playback.mediaSourceID == "source1")
        #expect(playback.playSessionID == "play1")
        #expect(!playback.url.absoluteString.contains("Volumes"))
    }

    @Test(arguments: ["/Videos/episode1/original.mkv?MediaSourceId=source1", "/emby/Videos/episode1/original.mkv?MediaSourceId=source1", "/proxy/emby/Videos/episode1/original.mkv?MediaSourceId=source1", "Videos/episode1/original.mkv?MediaSourceId=source1"])
    func directStreamRelativeFormsRetainProxyPrefix(_ directURL: String) async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            .init(data: try JSONSerialization.data(withJSONObject: ["PlaySessionId": "play1", "MediaSources": [["Id": "source1", "SupportsDirectPlay": true, "DirectStreamUrl": directURL]]]))
        }
        defer { transport.invalidateAndCancel() }
        let playback = try await EmbyClient(session: session(), urlSession: transport).playback(item: mediaItem())
        #expect(playback.url.path == "/proxy/emby/Videos/episode1/original.mkv")
        #expect(query(playback.url)["MediaSourceId"] == "source1")
        #expect(query(playback.url)["api_key"] == "private-token")
        #expect(playback.headers.isEmpty)
    }

    @Test func externalDirectStreamNeverReceivesEmbyCredentialsOrHeaders() async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            reply(#"{"PlaySessionId":"play1","MediaSources":[{"Id":"source1","SupportsDirectPlay":true,"DirectStreamUrl":"https://cdn.test/movie.mkv?signature=cdn-signature&api_key=private-token&X-Emby-Token=private-token","RequiredHttpHeaders":{"Authorization":"private-token","Referer":"https://emby.test"}}]}"#)
        }
        defer { transport.invalidateAndCancel() }
        let playback = try await EmbyClient(session: session(), urlSession: transport).playback(item: mediaItem())
        #expect(playback.url.absoluteString == "https://cdn.test/movie.mkv?signature=cdn-signature")
        #expect(playback.headers.isEmpty)
    }

    @Test func externalDirectStreamRetainsIndependentCDNSigningParameters() async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            reply(#"{"PlaySessionId":"play1","MediaSources":[{"Id":"source1","SupportsDirectPlay":true,"DirectStreamUrl":"https://cdn.test/movie.mkv?token=cdn-signature&access_token=cdn-access&api_key=cdn-api&signature=private-token"}]}"#)
        }
        defer { transport.invalidateAndCancel() }
        let playback = try await EmbyClient(session: session(), urlSession: transport).playback(item: mediaItem())
        #expect(playback.url.absoluteString == "https://cdn.test/movie.mkv?token=cdn-signature&access_token=cdn-access&api_key=cdn-api")
        #expect(!playback.url.absoluteString.contains("private-token"))
        #expect(playback.headers.isEmpty)
    }

    @Test(arguments: ["file:///etc/passwd", "smb://nas/private/movie.mkv", "https://user:pass@cdn.test/movie", "../private", "/Videos/%2e%2e/private"])
    func unsafeDirectStreamsAreRejected(_ directURL: String) async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            .init(data: try JSONSerialization.data(withJSONObject: ["PlaySessionId": "play1", "MediaSources": [["Id": "source1", "SupportsDirectPlay": true, "DirectStreamUrl": directURL]]]))
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        await #expect(throws: (any Error).self) { try await client.playback(item: mediaItem()) }
    }

    @Test(arguments: [EmbyPlaybackEvent.start, .progress, .stop])
    func sessionReportsUseTicksAndCorrectEndpoints(_ event: EmbyPlaybackEvent) async throws {
        let expectedPath: String
        switch event {
        case .start: expectedPath = "/proxy/emby/Sessions/Playing"
        case .progress: expectedPath = "/proxy/emby/Sessions/Playing/Progress"
        case .stop: expectedPath = "/proxy/emby/Sessions/Playing/Stopped"
        }
        let transport = EmbyFixtureProtocol.install { request in
            #expect(request.value(forHTTPHeaderField: "X-Emby-Token") == "private-token")
            let json = try body(request)
            #expect(json["ItemId"].string == "episode1")
            #expect(json["MediaSourceId"].string == "source1")
            #expect(json["PlaySessionId"].string == "play1")
            #expect(json["PositionTicks"].number == 427500000)
            #expect(json["IsPaused"].bool == true)
            #expect(json["PlayMethod"].string == "DirectStream")
            #expect(request.url!.path == expectedPath)
            return reply("", status: 204)
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        let playback = EmbyPlayback(url: URL(string: "https://emby.test/proxy/emby/Videos/episode1/stream")!, headers: [:], item: try mediaItem(), mediaSourceID: "source1", playSessionID: "play1", startSeconds: 12.5)
        try await client.report(event, playback: playback, position: 42.75, paused: true)
    }

    @Test func oversizedJSONIsRejectedBeforeDecoding() async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            .init(data: Data(repeating: 32, count: 8 * 1024 * 1024 + 1), headers: ["Content-Length": "8388609"])
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        await #expect(throws: EmbyClientError.responseTooLarge) { try await client.libraries() }
    }

    @Test func oversizedChunkedJSONIsRejectedDuringTransfer() async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            .init(data: Data(repeating: 32, count: 8 * 1024 * 1024 + 1))
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        await #expect(throws: EmbyClientError.responseTooLarge) { try await client.libraries() }
    }

    @Test func emptySourcesOrPlaybackErrorsCannotBecomeFilesystemPlayback() async throws {
        for response in [#"{"PlaySessionId":"play1","MediaSources":[]}"#,
                         #"{"PlaySessionId":"play1","ErrorCode":"NotAllowed","MediaSources":[{"Id":"source1","Path":"file:///private/video.mkv","SupportsDirectPlay":true}]}"#] {
            let transport = EmbyFixtureProtocol.install { _ in reply(response) }
            defer { transport.invalidateAndCancel() }
            let client = try EmbyClient(session: session(), urlSession: transport)
            await #expect(throws: EmbyClientError.noPlayableMedia) { try await client.playback(item: mediaItem()) }
        }
    }

    @Test func invalidPositionNeverSendsAProgressRequest() async throws {
        let transport = EmbyFixtureProtocol.install { _ in
            Issue.record("Invalid position must be rejected before requesting the server")
            return reply("", status: 204)
        }
        defer { transport.invalidateAndCancel() }
        let client = try EmbyClient(session: session(), urlSession: transport)
        let playback = EmbyPlayback(url: URL(string: "https://emby.test/stream")!, headers: [:], item: try mediaItem(), mediaSourceID: "source", playSessionID: "play", startSeconds: 0)
        for position in [Double.nan, .infinity, -1, Double.greatestFiniteMagnitude] {
            await #expect(throws: CoreError.invalidRequest) { try await client.report(.progress, playback: playback, position: position, paused: false) }
        }
    }
}
