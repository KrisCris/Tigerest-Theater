import Foundation
import Testing
@testable import AppleCore

@Test func preservesServerPathAndPort() throws {
    let server = try ServerAddress(" https://Example.COM:8443/emby/ ")
    #expect(server.origin == "https://example.com:8443")
    #expect(server.endpoint("System/Info/Public").absoluteString == "https://example.com:8443/emby/System/Info/Public")
}
@Test(arguments: ["file:///etc/passwd", "javascript:alert(1)", "https://user:password@example.com", "https://example.com/a/../b", "https://example.com/%2e%2e/b", "https://example.com?token=secret", "https://example.com/#fragment"])
func rejectsUnsafeAddresses(_ value: String) {
    #expect(throws: (any Error).self) { try ServerAddress(value) }
}
@Test func canonicalOriginKeepsIPv6AndNormalizesDefaultPort() throws {
    #expect(try ServerAddress("http://[::1]:8096/emby").origin == "http://[::1]:8096")
    #expect(try ServerAddress("https://example.com:443/").origin == "https://example.com")
}
