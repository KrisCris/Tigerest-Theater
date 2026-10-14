import Testing
@testable import AppleCore

@Test func horizontalGesturePreviewsBoundedSeekAndCommitsOnlyOnRelease() {
    var gesture = PlaybackGestureSession(x: 500, y: 250, width: 1000, height: 500, position: 120, duration: 600, volume: 0.5, brightness: 0.5)
    #expect(gesture.move(x: 750, y: 254) == .seek(142.5))
    #expect(gesture.finish() == 142.5)
    #expect(gesture.finish() == nil)
    var short = PlaybackGestureSession(x: 500, y: 250, width: 1000, height: 500, position: 10, duration: 12, volume: 0.5, brightness: 0.5)
    #expect(short.move(x: 1000, y: 250) == .seek(12))
    short.cancel()
    #expect(short.finish() == nil)
}

@Test func verticalGestureKeepsItsStartingSideAndClampsValues() {
    var left = PlaybackGestureSession(x: 250, y: 250, width: 1000, height: 500, position: 0, duration: 100, volume: 0.5, brightness: 0.5)
    #expect(left.move(x: 252, y: 200) == .brightness(0.7))
    #expect(left.move(x: 800, y: 500) == .brightness(0.02))
    #expect(left.finish() == nil)
    var right = PlaybackGestureSession(x: 750, y: 250, width: 1000, height: 500, position: 0, duration: 100, volume: 0.5, brightness: 0.5)
    #expect(right.move(x: 752, y: 125) == .volume(1))
    #expect(right.move(x: 200, y: 500) == .volume(0))
}

@Test func MovementDisqualifiesHoldEvenWhileDiagonalIsUndecided() {
    var gesture = PlaybackGestureSession(x: 500, y: 250, width: 1000, height: 500, position: 0, duration: 100, volume: 0.5, brightness: 0.5)
    #expect(gesture.move(x: 520, y: 270) == .none)
    let movedHold = gesture.beginHold()
    #expect(!movedHold)
    #expect(gesture.move(x: 600, y: 271) == .seek(9))
    var stationary = PlaybackGestureSession(x: 500, y: 250, width: 1000, height: 500, position: 0, duration: 100, volume: 0.5, brightness: 0.5)
    let stationaryHold = stationary.beginHold()
    #expect(stationaryHold)
    #expect(stationary.move(x: 800, y: 200) == .none)
    #expect(stationary.finish() == nil)
}

@Test func unknownDurationDoesNotProduceSeekAndScreenEdgesAreReserved() {
    var live = PlaybackGestureSession(x: 500, y: 250, width: 1000, height: 500, position: 40, duration: 0, volume: 0.5, brightness: 0.5)
    #expect(live.move(x: 750, y: 250) == .unseekable)
    #expect(live.finish() == nil)
    #expect(!PlaybackGestureSession.accepts(x: 24, y: 200, width: 1000, height: 500))
    #expect(!PlaybackGestureSession.accepts(x: 400, y: 476, width: 1000, height: 500))
    #expect(PlaybackGestureSession.accepts(x: 25, y: 25, width: 1000, height: 500))
}
