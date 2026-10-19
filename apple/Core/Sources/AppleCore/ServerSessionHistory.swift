import Foundation

/// Persist this entire value in secure storage. Only `history` is public metadata.
/// A candidate is committed by the caller after its authenticated library loads.
public struct ServerSessionHistory: Codable, Sendable {
    public private(set) var current: EmbySession?
    public private(set) var currentMode: String
    public private(set) var history: String
    private var sessions: [String: EmbySession]
    public init(current: EmbySession? = nil, mode: String = "custom", history: String = "") {
        self.current = current; currentMode = mode; self.history = history; sessions = [:]
        if let current, let key = ServerHistory.key(mode: mode, address: current.serverURL) { sessions[key] = current }
    }
    public var currentKey: String? { current.flatMap { ServerHistory.key(mode: currentMode, address: $0.serverURL) } }
    public var records: [ServerHistory.Record] {
        ServerHistory.list(history, current: current.map { .init(mode: currentMode, address: $0.serverURL) })
    }
    public func cached(key: String) -> EmbySession? { sessions[key] }
    public mutating func commit(_ session: EmbySession, mode: String, replacing: String? = nil,
                                name: String? = nil, at: Double = Date().timeIntervalSince1970 * 1000) throws {
        let text = try ServerHistory.remember(history, mode: mode, address: session.serverURL, at: at,
                                              replacing: replacing, current: current.map { .init(mode: currentMode, address: $0.serverURL) })
        let annotated = ServerHistory.annotate(text, mode: mode, address: session.serverURL, name: name,
                                               kind: session.kind.rawValue, serverId: session.serverID)
        guard let key = ServerHistory.key(mode: mode, address: session.serverURL) else { throw CoreError.invalidAddress }
        history = annotated; current = session; currentMode = mode; sessions[key] = session
    }
    public mutating func updateCurrent(_ session: EmbySession) {
        guard current?.serverURL == session.serverURL else { return }
        current = session
        if let key = currentKey { sessions[key] = session }
    }
    public mutating func forget(key: String) throws {
        guard key != currentKey else { throw CoreError.invalidSetting }
        history = ServerHistory.forget(history, key: key)
    }
    public mutating func logout() {
        if let key = currentKey { sessions.removeValue(forKey: key) }
        current = nil
    }
}
