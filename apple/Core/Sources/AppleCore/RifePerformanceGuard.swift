import Foundation

/// The desktop CoreML rule (`rife::PerformanceGuard`, non-Windows branch in
/// src/player/interpolation/InterpolationPolicy.cpp), line for line: after 30
/// predictions, each 3-second window compares delivered source pairs with the
/// source rate; two slow windows in a row mean the device cannot keep up.
/// Any suspension (pause, buffering, seeking) clears the streak.
public struct RifePerformanceGuard: Sendable {
    private var start: Int64 = -1
    private var firstPairs: UInt64 = 0, firstDrops: UInt64 = 0
    private var slowWindows = 0
    public init() {}
    public mutating func reset() { start = -1; firstPairs = 0; firstDrops = 0; slowWindows = 0 }
    /// - Parameters:
    ///   - pairs: source frames that went through the filter.
    ///   - p95Ms: inference time per prediction.
    ///   - drops: output plus decoder frame drops.
    ///   - fps: source frame rate.
    public mutating func update(nowMs now: Int64, predictions: UInt64, pairs: UInt64, p95Ms p95: Double,
                                drops: UInt64, fps: Double, suspended: Bool) -> Bool {
        if suspended || predictions < 30 || fps <= 0 { reset(); return false }
        if start < 0 || now < start || pairs < firstPairs || drops < firstDrops { start = now; firstPairs = pairs; firstDrops = drops; return false }
        if now - start < 3000 { return false }
        // Count delivered output as well as model production: GPU renderer load
        // can drop frames even while inference itself sustains the source rate.
        let deliveredPairs = Double(pairs - firstPairs) - Double(drops - firstDrops) / 2
        let throughput = deliveredPairs * 1000 / Double(now - start)
        let slow = throughput < fps * 0.9 && (p95 > 1000 / fps || drops > firstDrops)
        slowWindows = slow ? slowWindows + 1 : 0
        start = now; firstPairs = pairs; firstDrops = drops
        return slowWindows >= 2
    }
}
