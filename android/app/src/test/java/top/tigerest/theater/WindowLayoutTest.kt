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
 @Test fun onlyControlsInsetAndOnlyAtTheSelectedPanesScreenEdges() {
  assertEquals(Pane(100,0,2400,1040),WindowLayout.safeContent(Pane(0,0,2400,1080),2400,1080,EdgeInsets(100,0,0,40)))
  assertEquals(Pane(410,32,900,670),WindowLayout.safeContent(Pane(410,0,900,700),900,700,EdgeInsets(80,32,0,30)))
  assertEquals(Pane(0,410,800,860),WindowLayout.safeContent(Pane(0,410,800,900),800,900,EdgeInsets(0,40,0,40)))
 }
}
