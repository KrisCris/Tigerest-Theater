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
 @Test fun dynamicRangeNoticeMatchesTheAppleClients() {
  val dolbyVision = PlaybackContract.ColorParams(3840,2160,"bt.2020","pq",1000.6065)
  assertEquals("HDR 输出 · 杜比视界 Profile 8\n片源 3840×2160 · BT.2020 / PQ · 母版 1000 nits\n输出 BT.2020 / PQ · 由系统按屏幕能力映射亮度",
   PlaybackContract.dynamicRangeText(dolbyVision,PlaybackContract.ColorParams(primaries="bt.2020",gamma="pq",maxLuma=10000.0),8,"bt.2446a"))
  val sdrTarget = PlaybackContract.ColorParams(primaries="display-p3",gamma="gamma2.2",maxLuma=203.0)
  assertEquals("SDR 输出 · 杜比视界 Profile 8 已色调映射（bt.2446a）\n片源 3840×2160 · BT.2020 / PQ · 母版 1000 nits\n输出 Display P3 / Gamma 2.2",
   PlaybackContract.dynamicRangeText(dolbyVision,sdrTarget,8,"bt.2446a"))
  assertEquals("SDR 输出 · HDR10 已色调映射（自动）\n片源 1920×1080 · BT.2020 / PQ\n输出 Display P3 / Gamma 2.2",
   PlaybackContract.dynamicRangeText(PlaybackContract.ColorParams(1920,1080,"bt.2020","pq"),sdrTarget,0,""))
  val sdr = PlaybackContract.ColorParams(1920,1080,"bt.709","bt.1886")
  assertEquals("SDR 播放\n片源 1920×1080 · BT.709 / BT.1886\n输出 BT.709 / BT.1886",PlaybackContract.dynamicRangeText(sdr,sdr.copy(width=0,height=0),0,"bt.2446a"))
  assertNull(PlaybackContract.dynamicRangeText(sdr,PlaybackContract.ColorParams(),0,""))
  val unknownPeak = PlaybackContract.ColorParams(3840,2160,"bt.2020","pq",10000.0)
  assertEquals("HDR 输出 · HDR10\n片源 3840×2160 · BT.2020 / PQ\n输出 BT.2020 / PQ · 由系统按屏幕能力映射亮度",PlaybackContract.dynamicRangeText(unknownPeak,unknownPeak,0,""))
  val hlg = PlaybackContract.ColorParams(primaries="bt.2020",gamma="hlg")
  assertTrue(PlaybackContract.dynamicRangeText(hlg,hlg,0,"")!!.startsWith("HDR 输出 · HLG\n"))
 }
 @Test fun hdrSurfaceKeepsTheVideoAspect() {
  assertEquals(PlaybackContract.Size(2224,1251),PlaybackContract.fit(2224,2488,16.0/9))
  assertEquals(PlaybackContract.Size(1600,1200),PlaybackContract.fit(2400,1200,4.0/3))
  assertEquals(PlaybackContract.Size(2224,2488),PlaybackContract.fit(2224,2488,0.0))
 }
}
