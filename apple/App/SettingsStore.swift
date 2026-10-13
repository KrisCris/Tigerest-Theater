import Foundation
import AppleCore
@MainActor final class SettingsStore {
    private let file: URL
    private let policy: SettingsPolicy
    private(set) var values: [String: [String: JSONValue]] = [:]
    private(set) var descriptions: [String: JSONValue] = [:]
    private(set) var sections: [JSONValue] = []
    var changed: ((String, JSONValue) -> Void)?
    private let supported: [String: Set<String>] = [
        "home": ["displayOrder"],
        "main": ["enableMPV", "allowBrowserZoom", "userWebClient", "serverConnectionMode"],
        "audio": ["channels", "normalize"],
        "video": ["hardwareDecoding", "deinterlace", "cache", "aspect", "sync_mode", "default_playback_speed", "audio_delay.normal", "force_transcode_hevc", "force_transcode_4k", "force_transcode_av1", "force_transcode_hdr", "force_transcode_hi10p", "force_transcode_dovi", "always_force_transcode", "allow_transcode_to_hevc", "prefer_transcode_to_h265"],
        "mpv": ["enableDanmaku", "audioLanguage", "subtitleLanguage", "cachePause", "deband", "toneMapping"],
        "subtitles": ["ass_scale_border_and_shadow", "ass_style_override", "placement", "color", "border_color", "border_size", "background_color", "background_transparency", "size", "font"],
        "danmaku": ["bold", "fontsize", "outline", "shadow", "scrolltime", "opacity", "displayarea", "apiServer"]
    ]
    init(directory: URL) throws {
        file = directory.appending(path: "settings.json")
        let source = Bundle.main.url(forResource: "settings_description", withExtension: "json", subdirectory: "Web")!
        let groups = try JSONDecoder().decode([JSONValue].self, from: Data(contentsOf: source))
        for (index, group) in groups.enumerated() {
            guard let name = group["section"].string, name != "__meta__" else { continue }
            var raw: [String: JSONValue] = [:], visible: [JSONValue] = []
            for entry in group["values"].array ?? [] {
                guard let key = entry["value"].string else { continue }
                var value = entry["default"]
                if let defaults = value.array { value = defaults.first?["value"] ?? .string("") }
                if value == .null { value = .string("") }
                if name == "mpv" && key == "configMode" { value = .string("embedded") }
                if name == "video" && key == "hardwareDecoding" { value = .string("enabled") }
                if name == "subtitles" && key == "font" { value = .string("PingFang SC") }
                raw[key] = value
                guard supported[name]?.contains(key) == true, entry["hidden"].bool != true else { continue }
                var description: [String: JSONValue] = ["key": .string(key), "displayName": entry["display_name"], "help": entry["help"]]
                if name == "video" && key == "hardwareDecoding" { description["help"] = .string("使用 Apple VideoToolbox 硬件解码。异常时可选择复制模式或关闭。") }
                if entry["input_type"] != .null { description["inputType"] = entry["input_type"] }
                if entry["possible_range"] != .null { description["range"] = entry["possible_range"] }
                if let choices = entry["possible_values"].array {
                    var seen = Set<String>()
                    description["options"] = .array(choices.compactMap { choice in
                        guard let pair = choice.array, pair.count >= 2,
                              pair.count < 3 || pair[2]["platforms"] == .null,
                              pair[0] != .string("osx_compat"),
                              seen.insert(String(describing: pair[0])).inserted else { return nil }
                        return .object(["value": pair[0], "title": pair[1]])
                    })
                }
                visible.append(.object(description))
            }
            values[name] = raw
            if supported[name] != nil {
                descriptions[name] = .array(visible)
                sections.append(.object(["key": .string(name), "order": group["order"].number.map(JSONValue.number) ?? .number(Double(index))]))
            }
        }
        values["danmaku", default: [:]]["apiServer"] = .string("")
        descriptions["danmaku"] = .array((descriptions["danmaku"]?.array ?? []) + [.object(["key": .string("apiServer"), "displayName": .string("弹幕服务地址"), "help": .string("留空使用大河弹幕服务。")])])
        policy = SettingsPolicy(defaults: values)
        if let saved = try? JSONDecoder().decode([String: [String: JSONValue]].self, from: Data(contentsOf: file)) {
            for (section, entries) in saved { for (key, value) in entries { if supported[section]?.contains(key) == true, let valid = try? policy.validate(section: section, key: key, value: value) { values[section]?[key] = valid } } }
        }
    }
    func get(_ section: String, _ key: String) -> JSONValue { values[section]?[key] ?? .null }
    func set(_ section: String, _ key: String, _ value: JSONValue) throws {
        guard supported[section]?.contains(key) == true else { throw CoreError.invalidSetting }
        let validated = try policy.validate(section: section, key: key, value: value)
        if let choices = descriptions[section]?.array?.first(where: { $0["key"].string == key })?["options"].array,
           !choices.contains(where: { $0["value"] == validated }) { throw CoreError.invalidSetting }
        if section == "main", key == "userWebClient", let address = value.string, !address.isEmpty { _ = try ServerAddress(address) }
        var next = values; next[section]?[key] = validated
        try JSONEncoder().encode(next).write(to: file, options: .atomic)
        values = next; changed?(section, .object(next[section] ?? [:]))
    }
    func reset(_ section: String) throws {
        guard let defaults = policy.defaults[section] else { throw CoreError.invalidSetting }
        var next = values; next[section] = defaults
        try JSONEncoder().encode(next).write(to: file, options: .atomic)
        values = next; changed?(section, .object(defaults))
    }
}
