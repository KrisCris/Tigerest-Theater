package top.tigerest.theater
import org.junit.Assert.*
import org.junit.Test
class DanmakuClockTest {
 @Test fun resumeWaitsForMediaToActuallyAdvance() {
  val clock=DanmakuClock();clock.position(12.0,0,false,1.5,1)
  for(frame in 1..36) assertEquals("core-idle can clear before video restarts",12.0,clock.position(12.0,frame*8_333_333L,true,1.5,1),0.0)
  val first=clock.position(12.0+1.0/24,37*8_333_333L,true,1.5,1)
  assertEquals(12.0+1.0/24,first,.0001)
  assertTrue(clock.position(12.0+1.0/24,38*8_333_333L,true,1.5,1)>first)
 }
 @Test fun quantizedVideoMovesOnEveryDisplayFrame() {
  val clock=DanmakuClock();var previous=clock.position(10.0,0,true,1.0,1)
  for(frame in 1..240) {
   val raw=10.0+(frame/5)/24.0
   val actual=clock.position(raw,frame*8_333_333L,true,1.0,1)
   if(frame>=5) assertTrue("motion on display frame $frame",actual>previous)
   else assertEquals("wait for the first video timestamp",10.0,actual,0.0)
   assertTrue("bounded media drift",kotlin.math.abs(actual-raw)<.06);previous=actual
  }
 }
 @Test fun pauseBufferAndSeekDoNotFreeRun() {
  val clock=DanmakuClock();clock.position(10.0,0,true,1.0,1)
  assertEquals(10.0,clock.position(10.0,8_000_000,false,1.0,1),0.0)
  assertEquals(10.0,clock.position(10.0,900_000_000,false,1.0,1),0.0)
  assertEquals(25.0,clock.position(25.0,910_000_000,false,1.0,2),0.0)
  assertEquals(3.0,clock.position(3.0,920_000_000,true,1.0,3),0.0)
 }
 @Test fun speedAndSilentStallRemainBounded() {
  val clock=DanmakuClock();clock.position(9.96,-20_000_000,true,2.0,1);clock.position(10.0,0,true,2.0,1)
  assertEquals(10.02,clock.position(10.0,10_000_000,true,2.0,1),.0001)
  var value=0.0;for(i in 2..100)value=clock.position(10.0,i*10_000_000L,true,2.0,1)
  assertEquals(10.5,value,.0001)
 }
}
