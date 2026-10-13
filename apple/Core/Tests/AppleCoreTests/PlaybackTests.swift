import Testing
@testable import AppleCore
@Test func oldOrRepeatedEndNeverTerminatesReplacement() {
    var state = PlaybackState(); let first = state.begin(), second = state.begin()
    let old = state.finish(generation:first); #expect(!old); #expect(state.active)
    let ended = state.finish(generation:second); #expect(ended)
    let duplicate = state.finish(generation:second); #expect(!duplicate)
}
@Test func explicitPausePreventsInterruptionResume() {
    var state=PlaybackState(); state.begin(); let intent=state.pauseIntent
    #expect(state.mayResume(interruptedAt:intent)); state.userPaused()
    #expect(!state.mayResume(interruptedAt:intent))
}
@Test func trackAndUnitConversions() throws {
    #expect(PlaybackContract.track("#1")=="1")
    #expect(PlaybackContract.track("")=="no")
    #expect(PlaybackContract.track("-1")=="no")
    #expect(try PlaybackContract.rate(1500)==1.5)
    #expect(try PlaybackContract.seconds(3600)==3.6)
    #expect(throws:(any Error).self) { try PlaybackContract.rate(5000) }
}
@Test func temporaryRateRestoresExactlyOnce() {
    var speed=TemporarySpeed()
    let a=speed.begin(current:1.25), b=speed.begin(current:2), c=speed.end(), d=speed.end()
    #expect(a==2); #expect(b==nil); #expect(c==1.25); #expect(d==nil)
}
@Test func queueHasRealBoundaries() {
    let queue=EpisodeQueue(ids:["a","b","c"],current:"b")
    #expect(queue.neighbor(-1)=="a"); #expect(queue.neighbor(1)=="c"); #expect(queue.neighbor(2)==nil)
}
@Test func playbackWatchdogExcludesPausedTime() {
    var watch=PlaybackWatchdog()
    let a=watch.stalled(position:0,now:0,paused:false)
    let b=watch.stalled(position:0,now:31,paused:false)
    let c=watch.stalled(position:0,now:60,paused:true)
    let d=watch.stalled(position:0,now:61,paused:false)
    let e=watch.stalled(position:5,now:90,paused:false)
    #expect(!a); #expect(b); #expect(!c); #expect(!d); #expect(!e)
}
