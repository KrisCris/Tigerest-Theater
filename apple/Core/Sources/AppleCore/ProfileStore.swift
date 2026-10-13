import Foundation
public final class ProfileStore {
    public struct Profile: Codable, Identifiable, Sendable {
        public let id: UUID
        public let name: String
    }
    private struct Manifest: Codable { var selected: UUID; var profiles: [Profile] }
    public let root: URL
    private var manifest: Manifest
    public var currentID: UUID { manifest.selected }
    public var profiles: [Profile] { manifest.profiles }
    public init(root: URL) throws {
        self.root = root
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appending(path: "profiles.json")
        if FileManager.default.fileExists(atPath: url.path) {
            manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: url))
            guard manifest.profiles.contains(where: { $0.id == manifest.selected }) else { throw CoreError.invalidProfile }
        } else {
            let initial = Profile(id: UUID(), name: "默认配置")
            manifest = Manifest(selected: initial.id, profiles: [initial])
            try save(manifest)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }
    public var directory: URL { root.appending(path: currentID.uuidString, directoryHint: .isDirectory) }
    @discardableResult public func create(name: String) throws -> UUID {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 80, profiles.count < 100 else { throw CoreError.invalidProfile }
        let profile = Profile(id: UUID(), name: name)
        try FileManager.default.createDirectory(at: root.appending(path: profile.id.uuidString), withIntermediateDirectories: true)
        var next = manifest
        next.profiles.append(profile)
        try save(next)
        manifest = next
        return profile.id
    }
    public func select(_ id: UUID) throws {
        guard profiles.contains(where: { $0.id == id }) else { throw CoreError.invalidProfile }
        var next = manifest
        next.selected = id
        try save(next)
        manifest = next
    }
    private func save(_ value: Manifest) throws {
        try JSONEncoder().encode(value).write(to: root.appending(path: "profiles.json"), options: .atomic)
    }
}
