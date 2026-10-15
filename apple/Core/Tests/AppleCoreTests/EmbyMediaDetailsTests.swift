import Foundation
import Testing
@testable import AppleCore

struct EmbyMediaDetailsTests {
    @Test func derivesOnlyDocumentedMetadataAndKeepsCastRoles() throws {
        let item = try JSONValue(any: ["ProductionYear": 2026, "RunTimeTicks": 2_700_000_000,
          "Genres": [" 科幻 ", "剧情", "科幻", ""],
          "People": [["Name": "演员", "Type": "Actor", "Role": "船长"], ["Name": "导演", "Type": "Director"], ["Name": ""]],
          "MediaSources": [["Container": "mkv", "Bitrate": 8_000_000, "MediaStreams": [
            ["Type": "Video", "Codec": "hevc", "Width": 3840, "Height": 2160],
            ["Type": "Audio", "Codec": "aac", "Channels": 6, "Language": "zho"]]]]])
        let details = EmbyMediaDetails(item: item)
        #expect(details.productionYear == 2026)
        #expect(details.runtimeSeconds == 270)
        #expect(details.genres == ["科幻", "剧情"])
        #expect(details.people.count == 2)
        #expect(details.people.first?.role == "船长")
        #expect(details.people.last?.type == "Director")
        #expect(details.media.contains { $0.contains("3840×2160") && $0.contains("HEVC") })
        #expect(details.media.contains { $0.contains("AAC") && $0.contains("6") })
        #expect(!details.media.joined().contains("HDR"))
    }
    @Test func absentAndMalformedMetadataDoNotInventZeroYearOrQuality() throws {
        let details = EmbyMediaDetails(item: try JSONValue(any: ["ProductionYear": 0, "RunTimeTicks": -1,
          "Genres": ["", "  "], "People": [["Role": "unknown"]], "MediaStreams": [["Type": "Video", "Width": -1, "Height": 0]]]))
        #expect(details.productionYear == nil)
        #expect(details.runtimeSeconds == nil)
        #expect(details.people.isEmpty && details.genres.isEmpty && details.media.isEmpty)
        #expect(EmbyMediaDetails(item: .null).media.isEmpty)
    }
}
