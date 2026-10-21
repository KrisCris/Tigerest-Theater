import XCTest
import AppleCore

/// Runs the release-feed signature checks on the device itself: Android's system
/// Ed25519 passed on a computer and failed on a phone. Uses the desktop fixtures
/// and one read-only request to the live feed.
final class ReleaseFeedDeviceTests: XCTestCase {
    private func fixture(_ name: String) throws -> JSONValue {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: name, withExtension: "json"))
        return try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: url))
    }
    private func hex(_ text: String) -> Data {
        var data = Data(), index = text.startIndex
        while index < text.endIndex { let next = text.index(index, offsetBy: 2); data.append(UInt8(text[index..<next], radix: 16)!); index = next }
        return data
    }
    func testFixturesVerifyOnDevice() throws {
        let cases = try fixture("release_feed_cases")
        for vector in try XCTUnwrap(cases["ed25519"].array) {
            XCTAssertEqual(ReleaseFeed.verify(signature: hex(vector["signature"].string!), message: hex(vector["message"].string!),
                                              publicKey: hex(vector["publicKey"].string!)), vector["valid"].bool, vector["name"].string ?? "")
        }
        let keys = [cases["keyId"].string!: Data(base64Encoded: cases["publicKey"].string!)!]
        let now = ISO8601DateFormatter().date(from: cases["now"].string!)!
        for item in try XCTUnwrap(cases["envelopes"].array) {
            let expected = item["reason"].string ?? ""
            do { _ = try ReleaseFeed.releases(envelope: Data(item["envelope"].string!.utf8), keys: keys, now: now); XCTAssertEqual(expected, "", item["name"].string ?? "") }
            catch let rejected as ReleaseFeed.Rejected { XCTAssertEqual(rejected.reason, expected, item["name"].string ?? "") }
        }
        let production = try JSONEncoder().encode(try fixture("release_feed_production"))
        let releases = try ReleaseFeed.releases(envelope: production, now: ISO8601DateFormatter().date(from: "2026-10-21T10:53:13Z")!)
        XCTAssertEqual(releases.count, 30)
        XCTAssertEqual(releases.first?["tag_name"].string, "v2.9.3")
    }
    func testLiveFeedVerifiesOnDevice() async throws {
        var request = URLRequest(url: ReleaseFeed.productionURL); request.setValue("application/json", forHTTPHeaderField: "Accept"); request.timeoutInterval = 10
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let releases = try ReleaseFeed.releases(envelope: data)
        XCTAssertFalse(releases.isEmpty)
        let note = XCTAttachment(string: "live feed: \(releases.count) releases, newest \(releases.first?["tag_name"].string ?? "?")")
        note.name = "live-feed"; note.lifetime = .keepAlways; add(note)
    }
}
