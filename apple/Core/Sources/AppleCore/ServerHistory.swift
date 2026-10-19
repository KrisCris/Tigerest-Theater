import Foundation

/// Metadata only. Authentication stays in the web origin or native session store.
public enum ServerHistory {
    public static let limit = 20
    public struct Current: Sendable {
        public let mode: String
        public let address: String
        public init(mode: String, address: String) { self.mode = mode; self.address = address }
    }
    public struct Record: Codable, Identifiable, Equatable, Sendable {
        public var mode: String
        public var address: String
        public var name: String?
        public var kind: String?
        public var serverId: String?
        public var lastConnectedAt: Double
        public var key: String { mode == "tigerest" ? "tigerest" : "custom:" + address }
        public var id: String { key }
        public var title: String { name ?? URLComponents(string: address)?.host ?? address }
    }
    private struct Envelope: Encodable { let version = 1; let servers: [Record] }

    public static func canonicalAddress(_ input: String) -> String? {
        guard var parts = URLComponents(string: input.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = parts.scheme?.lowercased(), ["http", "https"].contains(scheme),
              let host = parts.host?.lowercased(), !host.isEmpty,
              (parts.user ?? "").isEmpty, (parts.password ?? "").isEmpty,
              parts.port == nil || (1...65535).contains(parts.port!) else { return nil }
        parts.scheme = scheme; parts.host = host; parts.user = nil; parts.password = nil
        if (scheme == "http" && parts.port == 80) || (scheme == "https" && parts.port == 443) { parts.port = nil }
        parts.query = nil; parts.fragment = nil
        var path = parts.percentEncodedPath.replacingOccurrences(of: "/web(?:/(?:index\\.html)?)?$", with: "/", options: [.regularExpression, .caseInsensitive])
        if !path.hasSuffix("/") { path += "/" }
        parts.percentEncodedPath = path
        return parts.url?.absoluteString
    }
    public static func key(mode: String, address: String) -> String? {
        guard ["custom", "tigerest"].contains(mode), let address = canonicalAddress(address) else { return nil }
        return mode == "tigerest" ? "tigerest" : "custom:" + address
    }
    private static func clean(_ text: String?) -> String? {
        let scalars = (text ?? "").unicodeScalars.filter {
            !((0...31).contains($0.value) || (127...159).contains($0.value)
              || (0x200b...0x200f).contains($0.value) || (0x202a...0x202e).contains($0.value) || (0x2066...0x2069).contains($0.value))
        }
        let value = String(String.UnicodeScalarView(scalars)).trimmingCharacters(in: .whitespacesAndNewlines)
        let limited = String(decoding: value.utf16.prefix(80), as: UTF16.self)
        return limited.isEmpty ? nil : limited
    }
    private static func sanitized(_ raw: JSONValue) -> Record? {
        guard let mode = raw["mode"].string, ["custom", "tigerest"].contains(mode),
              let address = raw["address"].string.flatMap(canonicalAddress) else { return nil }
        let kind = raw["kind"].string
        let id = raw["serverId"].string
        let validID = id.flatMap { $0.range(of: "^[A-Za-z0-9-]{1,64}$", options: .regularExpression) == nil ? nil : $0 }
        let at = raw["lastConnectedAt"].number ?? raw["lastConnectedAt"].string.flatMap(Double.init) ?? 0
        return Record(mode: mode, address: address, name: clean(raw["name"].string),
                      kind: ["emby", "jellyfin"].contains(kind ?? "") ? kind : nil,
                      serverId: mode == "tigerest" ? nil : validID,
                      lastConnectedAt: at.isFinite && at > 0 ? floor(at) : 0)
    }
    private static func ordered(_ records: [Record]) -> [Record] {
        records.enumerated().sorted { lhs, rhs in
            lhs.element.lastConnectedAt == rhs.element.lastConnectedAt ? lhs.offset < rhs.offset : lhs.element.lastConnectedAt > rhs.element.lastConnectedAt
        }.prefix(limit).map(\.element)
    }
    public static func parse(_ text: String) -> [Record] {
        guard text.utf16.count <= 32768, let data = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data), value["version"].number == 1,
              let rows = value["servers"].array else { return [] }
        var seen = Set<String>()
        return ordered(rows.compactMap { row in
            guard let record = sanitized(row), seen.insert(record.key).inserted else { return nil }
            return record
        })
    }
    public static func validate(_ text: String) throws {
        if text.isEmpty { return }
        guard text.utf16.count <= 32768, let data = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(JSONValue.self, from: data),
              let rows = value["servers"].array, rows.count <= limit else { throw CoreError.invalidSetting }
    }
    public static func serialize(_ records: [Record]) -> String {
        let data = try! JSONEncoder().encode(Envelope(servers: ordered(records)))
        return String(decoding: data, as: UTF8.self)
    }
    public static func list(_ text: String, current: Current?) -> [Record] {
        var records = parse(text)
        if let current, let record = sanitized(.object(["mode": .string(current.mode), "address": .string(current.address)])),
           !records.contains(where: { $0.key == record.key }) { records.append(record) }
        return records
    }
    public static func remember(_ text: String, mode: String, address: String, at: Double = Date().timeIntervalSince1970 * 1000,
                                replacing: String? = nil, current: Current? = nil) throws -> String {
        guard var record = sanitized(.object(["mode": .string(mode), "address": .string(address), "lastConnectedAt": .number(at)])) else { throw CoreError.invalidAddress }
        var records = list(text, current: current).filter { $0.key != replacing || replacing == record.key }
        if let old = records.first(where: { $0.key == record.key }) {
            record.name = old.name; record.kind = old.kind; record.serverId = mode == "tigerest" ? nil : old.serverId
        }
        records.removeAll { $0.key == record.key }
        let result = serialize([record] + records)
        try validate(result)
        return result
    }
    public static func annotate(_ text: String, mode: String, address: String, name: String?, kind: String?, serverId: String?) -> String {
        guard let key = key(mode: mode, address: address) else { return text }
        var records = parse(text)
        guard let index = records.firstIndex(where: { $0.key == key }) else { return text }
        let previous = records[index]
        var record = previous
        if let name, !name.isEmpty { record.name = clean(name) }
        if let kind, ["emby", "jellyfin"].contains(kind) { record.kind = kind }
        if mode == "tigerest" { record.serverId = nil }
        else if let serverId, serverId.range(of: "^[A-Za-z0-9-]{1,64}$", options: .regularExpression) != nil { record.serverId = serverId }
        if record == previous { return text }
        records[index] = record
        let result = serialize(records)
        return (try? validate(result)) != nil ? result : text
    }
    public static func forget(_ text: String, key: String) -> String { serialize(parse(text).filter { $0.key != key }) }
}
