import Foundation
import Testing
@testable import AppleCore
@Test func bridgeRejectsForeignFramesAndStalePages() {
    var policy = BridgePolicy(origin: "https://example.com")
    #expect(policy.allows(origin: "https://example.com", isMainFrame: true))
    #expect(!policy.allows(origin: "https://example.com.evil.test", isMainFrame: true))
    #expect(!policy.allows(origin: "https://example.com", isMainFrame: false))
    #expect(!policy.allows(origin: "http://example.com", isMainFrame: true))
    #expect(!policy.allows(origin: "https://example.com:8443", isMainFrame: true))
    let old = policy.epoch
    policy.advancePage()
    #expect(!policy.isCurrent(old))
    #expect(policy.isCurrent(policy.epoch))
}
@Test func rejectsInvalidRequestIDAndOversizedMessages() throws {
    let valid = Data(#"{"id":7,"component":"player","method":"pause","args":[]}"#.utf8)
    #expect(try BridgeRequest.decode(valid).id == 7)
    #expect(throws: (any Error).self) { try BridgeRequest.decode(Data(#"{"id":0,"component":"player","method":"pause","args":[]}"#.utf8)) }
    let big = Data(("{\"id\":1,\"component\":\"system\",\"method\":\"hello\",\"args\":[\"" + String(repeating:"a",count:1_048_576) + "\"]}").utf8)
    #expect(throws: (any Error).self) { try BridgeRequest.decode(big) }
}
