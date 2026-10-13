import Foundation
import AppleCore
struct QualityPreset: Decodable, Identifiable {
    let id: String
    let title: String
    let base: String
    let options: [String: String]
    let shaders: [String]
    static let bundled: [QualityPreset] = {
        guard let data = try? Data(contentsOf: Bundle.main.resourceURL!.appending(path: "Web/quality_presets.json")) else { return [] }
        return (try? JSONDecoder().decode([QualityPreset].self, from: data)) ?? []
    }()
}
struct QualitySelection: Codable {
    var preset = "native"
    var custom: [String: String] = [:]
    static func read(_ root: URL) -> Self {
        guard let data = try? Data(contentsOf: root.appending(path: "quality.json")) else { return Self() }
        if let current = try? JSONDecoder().decode(Self.self, from: data) { return current }
        return Self(custom: (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:])
    }
    func save(_ root: URL) throws { try JSONEncoder().encode(self).write(to: root.appending(path: "quality.json"), options: .atomic) }
}
extension PlaybackController {
    var qualitySelection: QualitySelection { QualitySelection.read(model.profiles.directory) }
    func selectQuality(_ selection: QualitySelection) throws {
        guard selection.preset == "native" || QualityPreset.bundled.contains(where: { $0.id == selection.preset }) else { throw CoreError.invalidSetting }
        _ = try MPVConfigurationPolicy.parse(selection.custom.map { $0.key + "=" + $0.value }.joined(separator: "\n"), shaderRoot: model.profiles.directory.appending(path: "Shaders"))
        let previous = qualitySelection
        do { try selection.save(model.profiles.directory); try applySettings() }
        catch {
            try? previous.save(model.profiles.directory)
            try? applySettings()
            throw error
        }
    }
    func applyQuality() throws {
        guard let engine else { return }
        let selection = qualitySelection
        if selection.preset != "native" {
            guard let preset = QualityPreset.bundled.first(where: { $0.id == selection.preset }), preset.base == "high-quality" else { throw CoreError.invalidSetting }
            // The engine starts with mpv's high-quality base. Only the repository's
            // trusted catalog can supply bundled paths or unrestricted profile keys.
            for (key, value) in preset.options.sorted(by: { $0.key < $1.key }) { try engine.qualitySetting(key, value) }
            let root = Bundle.main.resourceURL!.appending(path: "Web").standardizedFileURL
            let paths = try preset.shaders.map { path -> String in
                let url = root.appending(path: path).standardizedFileURL
                guard path.hasPrefix("shaders/"), url.path.hasPrefix(root.path + "/shaders/"), !url.path.contains(":"), FileManager.default.fileExists(atPath: url.path) else { throw CoreError.invalidSetting }
                return url.path
            }
            try engine.qualitySetting("glsl-shaders", paths.joined(separator: ":"))
        }
        let custom = try MPVConfigurationPolicy.parse(selection.custom.map { $0.key + "=" + $0.value }.joined(separator: "\n"), shaderRoot: model.profiles.directory.appending(path: "Shaders"))
        for (key,value) in custom.sorted(by: { $0.key < $1.key }) { try engine.qualitySetting(key,value) }
    }
}
