import Foundation

public struct EmbyMediaPerson: Sendable, Equatable {
    public let name: String
    public let type: String?
    public let role: String?
}

/// Presentation metadata derived solely from the server's item DTO. Missing
/// values stay absent; a resolution or codec never implies HDR or other quality.
public struct EmbyMediaDetails: Sendable, Equatable {
    public let productionYear: Int?
    public let runtimeSeconds: Double?
    public let genres: [String]
    public let people: [EmbyMediaPerson]
    public let media: [String]

    public init(item: JSONValue) {
        productionYear = Self.integer(item["ProductionYear"], maximum: 9999)
        let ticks = item["RunTimeTicks"].number
        runtimeSeconds = ticks.flatMap { $0.isFinite && $0 > 0 && $0 <= 6_000_000_000_000_000 ? $0 / 10_000_000 : nil }
        genres = Self.unique((item["Genres"].array ?? []).compactMap(Self.text))
        people = (item["People"].array ?? []).compactMap { person in
            guard let name = Self.text(person["Name"]) else { return nil }
            return EmbyMediaPerson(name: name, type: Self.text(person["Type"]), role: Self.text(person["Role"]))
        }
        let sources = item["MediaSources"].array ?? []
        var values: [String] = []
        for source in sources.isEmpty ? [item] : sources {
            if let container = Self.text(source["Container"]) { values.append(container.uppercased()) }
            let streams = source["MediaStreams"].array ?? item["MediaStreams"].array ?? []
            for stream in streams {
                let codec = Self.text(stream["Codec"])?.uppercased()
                switch stream["Type"].string {
                case "Video":
                    let resolution: String?
                    if let width = Self.integer(stream["Width"], maximum: 100_000), let height = Self.integer(stream["Height"], maximum: 100_000) {
                        resolution = "\(width)×\(height)"
                    } else { resolution = nil }
                    let parts = [codec, resolution].compactMap { $0 }
                    if !parts.isEmpty { values.append("视频 · " + parts.joined(separator: " · ")) }
                case "Audio":
                    let channels = Self.integer(stream["Channels"], maximum: 128).map { "\($0) 声道" }
                    let parts = [codec, channels, Self.text(stream["Language"])].compactMap { $0 }
                    if !parts.isEmpty { values.append("音频 · " + parts.joined(separator: " · ")) }
                default: break
                }
            }
            if let bitrate = Self.integer(source["Bitrate"], maximum: 10_000_000_000) {
                values.append(String(format: "%.1f Mbps", Double(bitrate) / 1_000_000))
            }
        }
        media = Self.unique(values)
    }
    private static func text(_ value: JSONValue) -> String? {
        guard let string = value.string?.trimmingCharacters(in: .whitespacesAndNewlines), !string.isEmpty else { return nil }
        return string
    }
    private static func integer(_ value: JSONValue, maximum: Double) -> Int? {
        guard let number = value.number, number.isFinite, number > 0, number <= maximum, number.rounded() == number else { return nil }
        return Int(number)
    }
    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { seen.insert($0).inserted }
    }
}
