import Foundation
public struct SettingsPolicy: Sendable {
    public let defaults: [String: [String: JSONValue]]
    public init(defaults: [String: [String: JSONValue]]) { self.defaults = defaults }
    public func validate(section: String, key: String, value: JSONValue) throws -> JSONValue {
        guard let expected = defaults[section]?[key] else { throw CoreError.invalidSetting }
        switch (expected, value) {
        case (.bool, .bool): break
        case (.string, .string(let text)):
            if section == "main", key == "knownServers" { try ServerHistory.validate(text) }
            else { guard text.utf8.count <= 4096 else { throw CoreError.invalidSetting } }
        case (.number, .number(let number)):
            guard number.isFinite else { throw CoreError.invalidSetting }
            let ranges: [String: ClosedRange<Double>] = [
                "video.cache": 10...500, "video.default_playback_speed": 0.25...4,
                "danmaku.opacity": 0...1, "danmaku.displayarea": 0...1,
                "danmaku.fontsize": 10...120, "danmaku.scrolltime": 2...40,
                "danmaku.outline": 0...10, "danmaku.shadow": 0...10
            ]
            if let range = ranges[section + "." + key], !range.contains(number) { throw CoreError.invalidSetting }
        case (.array, .array(let values)):
            guard values.count <= 256, values.allSatisfy({ $0.string != nil }) else { throw CoreError.invalidSetting }
        default: throw CoreError.invalidSetting
        }
        return value
    }
}
