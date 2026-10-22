import Testing
@testable import AppleCore
/// The same cases as tests/test_rife_policy.cpp for the desktop guard.
@Test func rifePerformanceGuardMatchesDesktopRule() {
    var guardian = RifePerformanceGuard()
    func update(_ now: Int64, _ predictions: UInt64, _ pairs: UInt64, _ p95: Double, _ drops: UInt64, _ fps: Double, _ suspended: Bool) -> Bool {
        guardian.update(nowMs: now, predictions: predictions, pairs: pairs, p95Ms: p95, drops: drops, fps: fps, suspended: suspended)
    }
    // Thirty calls warm up; two uninterrupted slow windows are required.
    #expect(!update(0, 30, 30, 50, 0, 30, false))
    #expect(!update(3000, 70, 70, 50, 1, 30, false))
    #expect(update(6000, 110, 110, 50, 2, 30, false))
    guardian.reset()
    #expect(!update(0, 30, 30, 50, 0, 30, false))
    #expect(!update(3000, 70, 70, 50, 1, 30, false))
    #expect(!update(6000, 70, 70, 50, 1, 30, true)) // pause/buffer/seek clears the streak
    #expect(!update(9000, 110, 110, 50, 2, 30, false))
    #expect(!update(12000, 150, 150, 50, 3, 30, false))
    #expect(update(15000, 190, 190, 50, 4, 30, false))
    guardian.reset()
    #expect(!update(0, 30, 30, 10, 0, 30, false))
    #expect(!update(3000, 70, 70, 10, 0, 30, false))
    #expect(!update(6000, 110, 110, 10, 0, 30, false)) // low delivery alone is not inference blame
    guardian.reset()
    #expect(!update(0, 30, 30, 50, 0, 30, false))
    #expect(!update(3000, 120, 120, 50, 0, 30, false))
    #expect(!update(6000, 210, 210, 50, 0, 30, false)) // maintained throughput, no fallback
    guardian.reset()
    #expect(!update(0, 30, 30, 10, 0, 30, false))
    #expect(!update(3000, 120, 120, 10, 30, 30, false))
    #expect(update(6000, 210, 210, 10, 60, 30, false)) // renderer loses output despite fast model
}
