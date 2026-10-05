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
}
