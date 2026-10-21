import Foundation
import Testing
@testable import AppleCore

/// The desktop fixtures (tests/fixtures/release_feed_*.json, copied into Fixtures).
private func fixture(_ name: String) throws -> JSONValue {
    let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures"))
    return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
}
private func hex(_ text: String) -> Data {
    var data = Data(), index = text.startIndex
    while index < text.endIndex {
        let next = text.index(index, offsetBy: 2)
        data.append(UInt8(text[index..<next], radix: 16)!); index = next
    }
    return data
}
private func date(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }

@Test func ed25519VectorsMatchTheDesktopImplementation() throws {
    let cases = try fixture("release_feed_cases")
    let vectors = try #require(cases["ed25519"].array)
    #expect(vectors.count == 9)
    for vector in vectors {
        let valid = ReleaseFeed.verify(signature: hex(vector["signature"].string!), message: hex(vector["message"].string!),
                                       publicKey: hex(vector["publicKey"].string!))
        #expect(valid == vector["valid"].bool, "\(vector["name"].string ?? "")")
    }
}

@Test func envelopesFailForTheDesktopReasons() throws {
    let cases = try fixture("release_feed_cases")
    let keys = [cases["keyId"].string!: Data(base64Encoded: cases["publicKey"].string!)!]
    let now = date(cases["now"].string!)
    let envelopes = try #require(cases["envelopes"].array)
    #expect(envelopes.count == 18)
    for item in envelopes {
        let data = Data(item["envelope"].string!.utf8), expected = item["reason"].string ?? ""
        do {
            _ = try ReleaseFeed.releases(envelope: data, keys: keys, now: now)
            #expect(expected.isEmpty, "\(item["name"].string ?? "") should fail with \(expected)")
        } catch let rejected as ReleaseFeed.Rejected {
            #expect(rejected.reason == expected, "\(item["name"].string ?? "")")
        }
    }
    #expect(throws: ReleaseFeed.Rejected(reason: "envelope over 2 MiB")) {
        try ReleaseFeed.releases(envelope: Data(count: ReleaseFeed.maximumEnvelopeBytes + 1), keys: keys, now: now)
    }
}

@Test func productionResponseVerifiesWithTheBuiltInKey() throws {
    let production = try fixture("release_feed_production")
    let envelope = try JSONEncoder().encode(production)
    let releases = try ReleaseFeed.releases(envelope: envelope, now: date("2026-10-21T10:53:13Z"))
    #expect(releases.count == 30)
    #expect(releases.first?["tag_name"].string == "v2.9.3")
    #expect(throws: ReleaseFeed.Rejected(reason: "release list older than 72 hours")) {
        try ReleaseFeed.releases(envelope: envelope, now: date("2026-10-24T10:52:14Z"))
    }
    var tampered = production.object!
    let payload = String(decoding: Data(base64Encoded: production["payload"].string!)!, as: UTF8.self)
    tampered["payload"] = .string(Data(payload.replacingOccurrences(of: "\"v2.9.3\"", with: "\"v2.9.4\"").utf8).base64EncodedString())
    #expect(throws: ReleaseFeed.Rejected(reason: "bad signature")) {
        try ReleaseFeed.releases(envelope: JSONEncoder().encode(JSONValue.object(tampered)), now: date("2026-10-21T10:53:13Z"))
    }
}
