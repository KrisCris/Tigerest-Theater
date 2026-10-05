package top.tigerest.theater
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class DanmakuMatchTest {
 private fun anime(id: Int,title: String) = JSONObject().put("bangumiId",id).put("animeTitle",title)
 @Test fun seasonTwoNeverSelectsExactSeasonOneBaseTitle() {
  val records = listOf(anime(1,"作品"),anime(2,"作品 第二季"))
  assertEquals(2,DanmakuMatch.select(records,"作品",2)!!.getInt("bangumiId"))
  assertNull(DanmakuMatch.select(listOf(records[0]),"作品",2))
 }
 @Test fun specialsRequireAnExplicitMatchingSpecialAndFirstSeasonCanUseBaseTitle() {
  val records = listOf(anime(1,"作品"),anime(2,"作品 第二季"),anime(3,"作品 OVA"))
  assertEquals(1,DanmakuMatch.select(records,"作品",1)!!.getInt("bangumiId"))
  assertEquals(3,DanmakuMatch.select(records,"作品",0)!!.getInt("bangumiId"))
  assertNull(DanmakuMatch.select(records.take(2),"作品",0))
 }
}
