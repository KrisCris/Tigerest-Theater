package top.tigerest.theater
import org.junit.Assert.*
import org.junit.Test
class PlaybackContractTest {
 @Test fun sharedMusicAndTrackSelectionHaveNativeSemantics() {
  assertFalse(PlaybackContract.isVideo("music")); assertFalse(PlaybackContract.isVideo("audio")); assertTrue(PlaybackContract.isVideo("video"))
  assertEquals("1",PlaybackContract.track("#1")); assertEquals("no",PlaybackContract.track("")); assertEquals("no",PlaybackContract.track("-1")); assertEquals("2",PlaybackContract.track("2"))
 }
 @Test fun mpvBackgroundUsesAlphaBeforeRgb() {
  assertEquals("#00000000",PlaybackContract.subtitleBackground("#000000","00"))
  assertEquals("#80000000",PlaybackContract.subtitleBackground("#000000","80"))
  assertEquals("#FF000000",PlaybackContract.subtitleBackground("#000000","FF"))
 }
}
