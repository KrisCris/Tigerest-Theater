package top.tigerest.theater
import org.junit.Assert.*
import org.junit.Test
class WindowLayoutTest {
 @Test fun flatWindowUsesEntireCurrentBoundsRatherThanDisplayResolution() {
  assertEquals(Pane(0,0,412,900),WindowLayout.pane(412,900,null))
  assertEquals(Pane(0,0,900,700),WindowLayout.pane(900,700,null))
 }
 @Test fun separatingHingeAvoidsControlsCrossingFoldInEitherOrientation() {
  assertEquals(Pane(0,410,800,900),WindowLayout.pane(800,900,Pane(0,400,800,410)))
  assertEquals(Pane(410,0,900,700),WindowLayout.pane(900,700,Pane(400,0,410,700)))
 }
 @Test fun webUserAgentIsTheSameOnTheFoldedAndUnfoldedScreen() {
  val folded = "Mozilla/5.0 (Linux; Android 16; 24072PX77C Build/BP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/155.0.8059.43 Mobile Safari/537.36"
  val unfolded = folded.replace(" Mobile Safari"," Safari")
  val expected = "$unfolded TigerestTheater/2.9.0"
  assertEquals(expected,WindowLayout.webUserAgent(folded,"2.9.0"))
  assertEquals(expected,WindowLayout.webUserAgent(unfolded,"2.9.0"))
  // Only the Mobile token goes; a model name containing it stays.
  assertEquals("Mozilla/5.0 (Linux; Android 16; MobileX) Safari/537.36 TigerestTheater/1",WindowLayout.webUserAgent("Mozilla/5.0 (Linux; Android 16; MobileX) Mobile Safari/537.36","1"))
 }
 @Test fun onlyControlsInsetAndOnlyAtTheSelectedPanesScreenEdges() {
  assertEquals(Pane(100,0,2400,1040),WindowLayout.safeContent(Pane(0,0,2400,1080),2400,1080,EdgeInsets(100,0,0,40)))
  assertEquals(Pane(410,32,900,670),WindowLayout.safeContent(Pane(410,0,900,700),900,700,EdgeInsets(80,32,0,30)))
  assertEquals(Pane(0,410,800,860),WindowLayout.safeContent(Pane(0,410,800,900),800,900,EdgeInsets(0,40,0,40)))
 }
}
