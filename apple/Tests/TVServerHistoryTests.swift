import AppleCore
import Foundation
import XCTest
@testable import TVHomeModel

@MainActor final class TVServerHistoryTests: XCTestCase {
    private func setup() async throws -> (TVAppModel, TVSessionStore) {
        _ = URLProtocol.registerClass(ServerHistoryProtocol.self)
        addTeardownBlock { URLProtocol.unregisterClass(ServerHistoryProtocol.self) }
        func session(_ path: String) -> EmbySession { EmbySession(serverURL: "https://server-history.invalid/" + path + "/", userID: "user", accessToken: "fixture", deviceID: "fixture", serverID: "fixture", serverKind: .jellyfin) }
        var state = ServerSessionHistory(current: session("a"))
        try state.commit(session("b"), mode: "custom")
        try state.commit(session("denied"), mode: "custom")
        try state.commit(session("slow"), mode: "custom")
        try state.commit(session("a"), mode: "custom")
        let store = TVSessionStore(state: state), model = TVAppModel(fixtureMode: false, store: store)
        await model.start()
        return (model, store)
    }
    func testSavedServerSuccessAndFailureRetainAuthentication() async throws {
        let (model, store) = try await setup()
        let old = try store.loadState().history
        model.openServerSettings()
        await model.connectRememberedServer(try XCTUnwrap(model.rememberedServers.first { $0.address.contains("/denied/") }))
        XCTAssertTrue(model.session?.serverURL.contains("/a/") == true)
        XCTAssertEqual(try store.loadState().history, old)
        XCTAssertNotNil(model.error)
        await model.connectRememberedServer(try XCTUnwrap(model.rememberedServers.first { $0.address.contains("/b/") }))
        XCTAssertTrue(model.session?.serverURL.contains("/b/") == true)
        XCTAssertFalse(model.showServerPicker)
        XCTAssertNotNil(try store.loadState().cached(key: "custom:https://server-history.invalid/a/"))
        model.forgetServer("custom:https://server-history.invalid/a/")
        XCTAssertNotNil(try store.loadState().cached(key: "custom:https://server-history.invalid/a/"))
    }
    func testCancelAndLateSelectionCannotReplaceNewServer() async throws {
        let (model, store) = try await setup()
        model.openServerSettings()
        let slow = try XCTUnwrap(model.rememberedServers.first { $0.address.contains("/slow/") })
        let pending = Task { await model.connectRememberedServer(slow) }
        try await Task.sleep(for: .milliseconds(20))
        model.closeServerSettings()
        await pending.value
        XCTAssertTrue(model.session?.serverURL.contains("/a/") == true)
        model.openServerSettings()
        let another = Task { await model.connectRememberedServer(slow) }
        try await Task.sleep(for: .milliseconds(20))
        await model.connectRememberedServer(try XCTUnwrap(model.rememberedServers.first { $0.address.contains("/b/") }))
        await another.value
        XCTAssertTrue(model.session?.serverURL.contains("/b/") == true)
        XCTAssertTrue(try store.load()?.serverURL.contains("/b/") == true)
    }
}
private final class ServerHistoryProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "server-history.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        if request.url!.path.contains("/slow/") { DispatchQueue.global().asyncAfter(deadline: .now() + 0.12) { self.reply() } }
        else { reply() }
    }
    private func reply() {
        let url = request.url!, info = url.path.hasSuffix("/System/Info/Public")
        let status = url.path.contains("/denied/") && !info ? 403 : 200
        let body = info ? "{\"Id\":\"fixture\",\"Version\":\"10.11.11\",\"ServerName\":\"History fixture\"}" : "{\"Items\":[],\"TotalRecordCount\":0}"
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8)); client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
