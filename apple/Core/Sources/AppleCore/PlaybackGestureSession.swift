import Foundation

/// Android PlayerGestures semantics, independent of the platform touch API.
public struct PlaybackGestureSession {
    public enum Feedback: Equatable, Sendable {
        case none, seek(Double), volume(Double), brightness(Double), unseekable
    }
    private enum Axis { case undecided, seek, volume, brightness, hold }
    private let x: Double, y: Double, width: Double, height: Double
    private let position: Double, duration: Double, volume: Double, brightness: Double
    private var axis = Axis.undecided
    private var holdEligible = true, ended = false
    private var target: Double?
    public init(x: Double, y: Double, width: Double, height: Double, position: Double, duration: Double, volume: Double, brightness: Double) {
        self.x = x; self.y = y; self.width = max(1, width); self.height = max(1, height)
        self.position = max(0, position); self.duration = max(0, duration)
        self.volume = min(1, max(0, volume)); self.brightness = min(1, max(0.02, brightness))
    }
    public static func accepts(x: Double, y: Double, width: Double, height: Double) -> Bool {
        x > 24 && x < width - 24 && y > 24 && y < height - 24
    }
    public mutating func move(x: Double, y: Double) -> Feedback {
        guard !ended else { return .none }
        let dx = x - self.x, dy = y - self.y
        if axis == .undecided, max(abs(dx), abs(dy)) > 12 {
            holdEligible = false
            if abs(dx) > abs(dy) * 1.2 { axis = .seek }
            else if abs(dy) > abs(dx) * 1.2 { axis = self.x < width / 2 ? .brightness : .volume }
        }
        switch axis {
        case .seek:
            guard duration > 0 else { return .unseekable }
            let value = min(duration, max(0, position + dx / width * min(duration, 90)))
            target = value; return .seek(value)
        case .volume: return .volume(min(1, max(0, volume - dy / height * 2)))
        case .brightness: return .brightness(min(1, max(0.02, brightness - dy / height * 2)))
        case .undecided, .hold: return .none
        }
    }
    public mutating func beginHold() -> Bool {
        guard !ended, holdEligible, axis == .undecided else { return false }
        axis = .hold; return true
    }
    public mutating func finish() -> Double? {
        guard !ended else { return nil }
        ended = true; return axis == .seek ? target : nil
    }
    public mutating func cancel() { ended = true; target = nil; holdEligible = false }
}
