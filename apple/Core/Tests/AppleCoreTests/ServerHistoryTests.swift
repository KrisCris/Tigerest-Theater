import Foundation
import Testing
@testable import AppleCore

@Test func serverHistoryCanonicalVectors() {
    let vectors: [(String,String?)] = [
        ("HTTP://Media.Example:80/", "http://media.example/"),
        ("https://media.example:443/jellyfin/web/index.html?x=1#/home", "https://media.example/jellyfin/"),
        ("http://[FE80::2]:8096/web", "http://[fe80::2]:8096/"),
        ("http://192.168.1.5:8096", "http://192.168.1.5:8096/"),
        ("https://a.example/emby/web/", "https://a.example/emby/"),
        ("https://a.example/Web/Index.html", "https://a.example/"),
        ("http://u:p@a.example/", nil), ("ftp://a.example/", nil)
    ]
    for (input, expected) in vectors { #expect(ServerHistory.canonicalAddress(input) == expected) }
}
@Test func serverHistoryMigrationEditAndDistinctPaths() throws {
    let current = ServerHistory.Current(mode: "custom", address: "https://a.test/one/")
    let text = try ServerHistory.remember("", mode: "custom", address: "https://a.test/two/web", at: 10, current: current)
    let rows = ServerHistory.parse(text)
    #expect(rows.map(\.address) == ["https://a.test/two/", "https://a.test/one/"])
    #expect(rows.map(\.lastConnectedAt) == [10, 0])
    let annotated = ServerHistory.annotate(text, mode: "custom", address: rows[0].address, name: "\u{202e} Name\n", kind: "jellyfin", serverId: "abc")
    #expect(ServerHistory.parse(annotated)[0].name == "Name")
    let edit = try ServerHistory.remember(annotated, mode: "custom", address: "https://a.test/three/", at: 20, replacing: rows[0].key, current: current)
    #expect(ServerHistory.parse(edit).map(\.address) == ["https://a.test/three/", "https://a.test/one/"])
    #expect(ServerHistory.parse(ServerHistory.forget(edit, key: rows[1].key)).count == 1)
    #expect(ServerHistory.list("broken", current: current).count == 1)
    #expect(ServerHistory.parse("broken").isEmpty)
    #expect(ServerHistory.annotate("", mode: "custom", address: current.address, name: "A", kind: "emby", serverId: "abc") == "")
}
@Test func serverHistoryDedicatedAndLimits() throws {
    var text = try ServerHistory.remember("", mode: "tigerest", address: "http://10.0.0.2:8096", at: 1)
    text = ServerHistory.annotate(text, mode: "tigerest", address: "http://10.0.0.2:8096", name: "Local", kind: "emby", serverId: "secret-id")
    text = try ServerHistory.remember(text, mode: "tigerest", address: "https://remote.test/", at: 2)
    #expect(ServerHistory.parse(text).count == 1)
    #expect(ServerHistory.parse(text)[0].serverId == nil)
    for i in 0..<25 { text = try ServerHistory.remember(text, mode: "custom", address: "https://\(i).test/base/", at: Double(i + 3)) }
    #expect(ServerHistory.parse(text).count == 20)
    #expect(ServerHistory.parse(text)[0].address == "https://24.test/base/")
    let policy = SettingsPolicy(defaults: ["main": ["knownServers": .string("")]])
    #expect(try policy.validate(section: "main", key: "knownServers", value: .string(text)) == .string(text))
    for invalid in ["no-json", "[]", "{}", "{\"servers\":[]}" + String(repeating: " ", count: 32769), "{\"servers\":[" + Array(repeating: "{}", count: 21).joined(separator: ",") + "]}"] {
        #expect(throws: (any Error).self) { try policy.validate(section: "main", key: "knownServers", value: .string(invalid)) }
    }
    let long = "{\"version\":1,\"servers\":[],\"padding\":\"" + String(repeating: "x", count: 5000) + "\"}"
    #expect(try policy.validate(section: "main", key: "knownServers", value: .string(long)) == .string(long))
}

@Test func nativeServerHistoryKeepsSeparateSessionsAndOnlyExplicitLogoutClearsAuthentication() throws {
    func session(_ address: String, _ token: String) -> EmbySession {
        EmbySession(serverURL: address, userID: "test-user", accessToken: token, deviceID: "fixture", serverID: "id", serverKind: .jellyfin)
    }
    let a = session("https://same.test/a/", "token-a"), b = session("https://same.test/b/", "token-b")
    var state = ServerSessionHistory(current: a)
    try state.commit(b, mode: "custom", at: 2)
    #expect(ServerHistory.parse(state.history).map(\.address) == [b.serverURL, a.serverURL])
    #expect(state.cached(key: "custom:" + a.serverURL)?.accessToken == "token-a")
    let restored = try JSONDecoder().decode(ServerSessionHistory.self, from: JSONEncoder().encode(state))
    #expect(restored.current?.serverURL == b.serverURL)
    try state.forget(key: "custom:" + a.serverURL)
    #expect(state.cached(key: "custom:" + a.serverURL)?.accessToken == "token-a")
    #expect(throws: (any Error).self) { try state.forget(key: "custom:" + b.serverURL) }
    state.logout()
    #expect(state.current == nil)
    #expect(state.cached(key: "custom:" + b.serverURL) == nil)
    #expect(state.cached(key: "custom:" + a.serverURL)?.accessToken == "token-a")
    #expect(!state.history.contains("token-"))
}
