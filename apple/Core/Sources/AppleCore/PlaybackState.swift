import Foundation
public struct PlaybackState: Sendable {
    public private(set) var generation: UInt64 = 0
    public private(set) var active = false
    public private(set) var pauseIntent: UInt64 = 0
    public init() {}
    @discardableResult public mutating func begin() -> UInt64 { generation &+= 1; active = true; return generation }
    public mutating func finish(generation: UInt64) -> Bool { guard active, generation == self.generation else { return false }; active = false; return true }
    public mutating func userPaused() { pauseIntent &+= 1 }
    public func mayResume(interruptedAt: UInt64) -> Bool { active && interruptedAt == pauseIntent }
}
public enum PlaybackContract {
    public static func track(_ value: String) -> String { let clean = value.hasPrefix("#") ? String(value.dropFirst()) : value; return (Int(clean).map { $0 >= 0 } == true) ? clean : "no" }
    public static func rate(_ value: Double) throws -> Double { let rate = value / 1000; guard rate.isFinite, (0.25...4).contains(rate) else { throw CoreError.invalidRequest }; return rate }
    public static func seconds(_ milliseconds: Double) throws -> Double { guard milliseconds.isFinite else { throw CoreError.invalidRequest }; return max(0, milliseconds / 1000) }
}
public struct TemporarySpeed {
    private var saved: Double?
    public init() {}
    public mutating func begin(current: Double) -> Double? { guard saved == nil else { return nil }; saved = current; return 2 }
    public mutating func end() -> Double? { defer { saved = nil }; return saved }
}
public struct EpisodeQueue: Sendable {
    public var ids: [String]; public var current: String
    public init(ids: [String], current: String) { self.ids = ids; self.current = current }
    public func neighbor(_ delta: Int) -> String? { guard let index = ids.firstIndex(of: current), ids.indices.contains(index + delta) else { return nil }; return ids[index + delta] }
}
public struct PlaybackWatchdog: Sendable {
    private var changedAt: Double = 0, position: Double = -1
    public init() {}
    public mutating func stalled(position: Double, now: Double, paused: Bool) -> Bool { if paused || abs(position - self.position) > 0.01 { changedAt = now; self.position = position }; return !paused && now - changedAt >= 30 }
}
