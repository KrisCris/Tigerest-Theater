// Test boundaries only: production TVAppModel and EmbyClient remain unmodified.
import AppleCore
import Foundation

@MainActor final class TVPlaybackController {
    var onStopped: ((JSONValue, Double, Double) -> Void)?
    var onStopReported: ((JSONValue, EmbyClient) -> Void)?
    private(set) var playbackGeneration = UUID()
    private(set) var played: [EmbyPlayback] = []
    private(set) var active = false
    var failNextPlayback = false
    func stop() { playbackGeneration = UUID(); active = false }
    func play(_ playback: EmbyPlayback, client: EmbyClient, session: EmbySession? = nil) throws {
        playbackGeneration = UUID()
        if failNextPlayback { failNextPlayback = false; active = false; throw NSError(domain: "fixture-player", code: 1) }
        active = true; played.append(playback)
    }
}
/// The sessions TVAppModel saved, oldest first.
final class TVSavedSessions: @unchecked Sendable { var sessions: [EmbySession] = [] }
final class TVSessionBox { var value: ServerSessionHistory; init(_ value: ServerSessionHistory) { self.value = value } }
struct TVSessionStore {
    private let box: TVSessionBox
    let saved: TVSavedSessions?
    init(initialSession: EmbySession? = nil, saved: TVSavedSessions? = nil) {
        box = TVSessionBox(ServerSessionHistory(current: initialSession)); self.saved = saved
    }
    init(state: ServerSessionHistory) { box = TVSessionBox(state); saved = nil }
    func loadState() throws -> ServerSessionHistory { box.value }
    func load() throws -> EmbySession? { box.value.current }
    func save(_ session: EmbySession) throws { box.value.updateCurrent(session); saved?.sessions.append(session) }
    func commit(_ session: EmbySession, mode: String, replacing: String?, name: String?) throws {
        try box.value.commit(session, mode: mode, replacing: replacing, name: name); saved?.sessions.append(session)
    }
    func forget(_ key: String) throws { try box.value.forget(key: key) }
    func clear() throws { box.value.logout() }
    func deviceID() throws -> String { "fixture-device" }
}
