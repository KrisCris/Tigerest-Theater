import Foundation

/// A one-way, per-file guard for the optional lightweight shader. Rendering
/// drops are evaluated separately from decoder/network/seek interruptions.
struct TVFrameStability {
    enum Reduction { case highFrameRate, renderOverload }
    private struct Sample {
        let time: Double, position: Double, renderDrops: Double, decoderDrops: Double
    }
    private var previous: Sample?
    private var window: Sample?
    private var settledSince: Double?
    private var highFPSSince: Double?
    private var badWindows = 0
    private var issued = false

    mutating func interrupt() {
        previous = nil; window = nil; settledSince = nil; highFPSSince = nil; badWindows = 0
        // Once attempted, do not oscillate or repeatedly retry a failed apply.
        // A new file or an explicit quality selection creates a fresh guard.
    }

    mutating func observe(now: Double, position: Double, fps: Double?, renderDrops: Double?,
                          decoderDrops: Double?, paused: Bool, buffering: Bool) -> Reduction? {
        guard !issued else { return nil }
        guard !paused, !buffering, now.isFinite, position.isFinite,
              let renderDrops, renderDrops.isFinite, renderDrops >= 0,
              let decoderDrops, decoderDrops.isFinite, decoderDrops >= 0 else {
            interrupt(); return nil
        }
        let sample = Sample(time: now, position: position, renderDrops: renderDrops, decoderDrops: decoderDrops)
        if let previous {
            let elapsed = now - previous.time, progress = position - previous.position
            guard elapsed > 0, elapsed <= 3, progress >= -0.05, progress <= elapsed * 1.5 + 0.5,
                  renderDrops >= previous.renderDrops, decoderDrops == previous.decoderDrops else {
                interrupt(); self.previous = sample; return nil
            }
        }
        previous = sample
        if settledSince == nil { settledSince = now }

        // Measured frame durations, not the container's sometimes incorrect FPS.
        // Require a sustained reading so a single post-seek estimate is ignored.
        if let fps, fps.isFinite, fps >= 48 {
            if highFPSSince == nil { highFPSSince = now }
            if now - highFPSSince! >= 1 { issued = true; return .highFrameRate }
        } else { highFPSSince = nil }

        // Ignore load/seek warmup. Two consecutive two-second windows must each
        // lose at least two render frames per second before dropping the shader.
        guard now - settledSince! >= 5 else { return nil }
        guard let start = window else { window = sample; return nil }
        let elapsed = now - start.time
        guard elapsed >= 2 else { return nil }
        window = sample
        guard position - start.position >= elapsed * 0.5 else { interrupt(); return nil }
        badWindows = (renderDrops - start.renderDrops) / elapsed >= 2 ? badWindows + 1 : 0
        if badWindows >= 2 { issued = true; return .renderOverload }
        return nil
    }
}
