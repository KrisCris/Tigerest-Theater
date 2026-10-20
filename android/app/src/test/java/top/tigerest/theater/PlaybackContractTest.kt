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
 @Test fun hdrOutputRedrawsOnlyTextSubtitles() {
  for(codec in listOf("hdmv_pgs_subtitle","dvd_subtitle","DVB_SUBTITLE")) assertTrue(codec,PlaybackContract.isImageSubtitle(codec))
  for(codec in listOf("ass","subrip","webvtt","mov_text")) assertFalse(codec,PlaybackContract.isImageSubtitle(codec))
 }
 @Test fun overlaySubtitlesUseMpvScale() {
  val style = PlaybackContract.SubtitleStyle(1440,55.0,3.0)
  assertEquals(110f,style.textSize,.01f); assertEquals(6f,style.border,.01f); assertEquals(44f,style.verticalMargin,.01f)
 }
 @Test fun hdrSurfaceKeepsTheVideoAspect() {
  assertEquals(PlaybackContract.Size(2224,1251),PlaybackContract.fit(2224,2488,16.0/9))
  assertEquals(PlaybackContract.Size(1600,1200),PlaybackContract.fit(2400,1200,4.0/3))
  assertEquals(PlaybackContract.Size(2224,2488),PlaybackContract.fit(2224,2488,0.0))
 }
}
