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
 @Test fun duplicateWorkResultsChooseAStableAvailableCandidate() {
  assertEquals(1,DanmakuMatch.select(listOf(anime(2,"作品"),anime(1,"作品")),"作品",1)!!.getInt("bangumiId"))
 }
 @Test fun quotationDifferencesDoNotHideTheRequestedWork() {
  val title="「凭你也想讨伐魔王？」被勇者小队逐出队伍，只好在王都自在过活"
  assertEquals(19310,DanmakuMatch.select(listOf(anime(19310,"凭你也想讨伐魔王？被勇者小队逐出队伍，只好在王都自在过活")),title,1)!!.getInt("bangumiId"))
 }
 private fun episode(id: Int,number: String,title: String,date: String="") = JSONObject()
  .put("episodeId",id).put("episodeNumber",number).put("episodeTitle",title).put("airDate",date)
 private fun resolve(records: List<JSONObject>,date: String="2026-01-08T16:00:00Z",name: String="开始与结束") =
  DanmakuMatch.resolve(listOf(anime(19310,"作品")),"作品",1,1,date,name){records}
 @Test fun creditsAndTranslatedEpisodeNamesDoNotRejectTheRegularEpisode() {
  val match=resolve(listOf(episode(193109101,"C1","C1 Opening","2026-01-09"),
   episode(193109102,"C2","C2 Ending","2026-01-09"),episode(193100001,"1","第1话 Beginning and End","2026-01-09")))
  assertEquals(193100001,match!!.episode.getInt("episodeId"))
 }
 @Test fun sevenDayBoundaryIsInclusiveAndEightDaysAreRejected() {
  assertEquals(1,resolve(listOf(episode(1,"1","第1话 开始与结束","2026-01-15")))!!.episode.getInt("episodeId"))
  assertNull(resolve(listOf(episode(2,"1","第1话 开始与结束","2026-01-16"))))
 }
 @Test fun matchingEpisodeNumberCanUseAnUnknownProviderDate() {
  assertEquals(1,resolve(listOf(episode(1,"1","第1话 Another translation","invalid")))!!.episode.getInt("episodeId"))
  assertNull(resolve(listOf(episode(2,"2","第2话 Another translation"))))
 }
 @Test fun nearbyCandidatesPreferEpisodeTextThenDistanceThenStableIdentity() {
  val records=listOf(episode(3,"1","第1话 Another translation","2026-01-09"),
   episode(2,"1","第1话 开始与结束","2026-01-10"),episode(1,"1","第1话 开始与结束","2026-01-10"))
  assertEquals(1,resolve(records)!!.episode.getInt("episodeId"))
  assertEquals(1,resolve(records.reversed())!!.episode.getInt("episodeId"))
 }
 @Test fun exactDateAndEpisodeTitleCanResolveCumulativeNumbering() {
  val records=listOf(episode(1,"1","第1话 开始与结束","2026-01-08"),episode(2,"2","第2话 另一集","2026-01-08"))
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,13,"2026-01-08","开始与结束"){records}
  assertEquals(1,match!!.episode.getInt("episodeId"))
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,13,"2026-01-08","不同的标题"){records})
 }
 @Test fun aFailedAlternativeDoesNotDiscardAUsableMatch() {
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品"),anime(2,"作品")),"作品",1,1,"2026-01-08","开始与结束"){
   if(it.getInt("bangumiId")==1) error("provider unavailable")
   listOf(episode(2,"1","第1话 开始与结束","2026-01-09"))
  }
  assertEquals(2,match!!.episode.getInt("episodeId"))
 }
 @Test fun cancellationDuringReleaseFetchCannotReturnAnOldMatch() {
  var current=true
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,1,"2026-01-08","开始与结束",isCurrent={current}){
   current=false;listOf(episode(1,"1","第1话 开始与结束","2026-01-09"))
  })
 }
 @Test fun rememberedManualReleaseOutranksOtherwiseEquivalentNearbyCandidates() {
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品"),anime(2,"作品")),"作品",1,1,"2026-01-08","开始与结束",savedBangumi="2"){
   listOf(episode(it.getInt("bangumiId"),"1","第1话 开始与结束","2026-01-09"))
  }
  assertEquals(2,match!!.anime.getInt("bangumiId"))
 }
}
