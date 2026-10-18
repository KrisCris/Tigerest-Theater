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
struct TVSessionStore {
    var initialSession: EmbySession? = nil
    var saved: TVSavedSessions? = nil
    func load() throws -> EmbySession? { initialSession }
    func save(_ session: EmbySession) throws { saved?.sessions.append(session) }
    func clear() throws {}
    func deviceID() throws -> String { "fixture-device" }
}
