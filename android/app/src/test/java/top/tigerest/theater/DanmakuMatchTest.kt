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
 @Test fun fractionNotationDoesNotHideTheRequestedSeason() {
  assertEquals(2,DanmakuMatch.select(listOf(anime(1,"乱马1/2"),anime(2,"乱马1/2 第三季")),"乱马½",3)!!.getInt("bangumiId"))
 }
 @Test fun explicitSeasonInBothQueryAndCandidateStillIdentifiesTheWork() {
  for(candidate in listOf("作品 第二季","作品 Season 2")) {
   assertEquals(2,DanmakuMatch.select(listOf(anime(2,candidate)),"作品 第二季",2)!!.getInt("bangumiId"))
  }
 }
 @Test fun multiDigitOrdinalSeasonsKeepTheWholeSeasonNumber() {
  for((season,ordinal) in listOf(11 to "11th",12 to "12th",21 to "21st",23 to "23rd")) {
   val title="作品 $ordinal season"
   assertEquals(2,DanmakuMatch.select(listOf(anime(2,title)),title,season)!!.getInt("bangumiId"))
   assertNull(DanmakuMatch.select(listOf(anime(2,title)),title,season%10))
  }
 }
 @Test fun conflictingExplicitQueryAndCandidateSeasonsRemainRejected() {
  assertNull(DanmakuMatch.select(listOf(anime(3,"作品 第三季")),"作品 第二季",2))
  assertNull(DanmakuMatch.select(listOf(anime(1,"作品")),"作品 第二季",2))
  assertNull(DanmakuMatch.select(listOf(anime(3,"作品 第三季")),"作品 第三季",2))
  assertNull(DanmakuMatch.select(listOf(anime(4,"Unrelated different series 第二季")),"作品 第二季",2))
 }
 private fun episode(id: Int,number: String,title: String,date: String="") = JSONObject()
  .put("episodeId",id).put("episodeNumber",number).put("episodeTitle",title).put("airDate",date)
 private fun resolve(records: List<JSONObject>,name: String="开始与结束") =
  DanmakuMatch.resolve(listOf(anime(19310,"作品")),"作品",1,1,name){records}
 @Test fun creditsAndTranslatedEpisodeNamesDoNotRejectTheRegularEpisode() {
  val match=resolve(listOf(episode(193109101,"C1","C1 Opening","2026-01-09"),
   episode(193109102,"C2","C2 Ending","2026-01-09"),episode(193100001,"1","第1话 Beginning and End","2026-01-09")))
  assertEquals(193100001,match!!.episode.getInt("episodeId"))
 }
 @Test fun datesNeverGateMatchingWorkSeasonAndEpisodeNumber() {
  for(date in listOf("2026-01-15","2026-01-16","1989-04-15","", "invalid")) {
   assertEquals(1,resolve(listOf(episode(1,"1","第1话 Another translation",date)))!!.episode.getInt("episodeId"))
  }
 }
 @Test fun matchingEpisodeNumberCanUseAnUnknownProviderDate() {
  assertEquals(1,resolve(listOf(episode(1,"1","第1话 Another translation","invalid")))!!.episode.getInt("episodeId"))
  assertNull(resolve(listOf(episode(2,"2","第2话 Another translation"))))
 }
 @Test fun duplicateExactEpisodeTitlesRemainAmbiguous() {
  val records=listOf(episode(3,"1","第1话 Another translation","2026-01-09"),
   episode(2,"1","第1话 开始与结束","2026-01-10"),episode(1,"1","第1话 开始与结束","2026-01-10"))
  assertNull(resolve(records))
  assertNull(resolve(records.reversed()))
 }
 @Test fun uniqueEpisodeTitleOverridesCumulativeNumberEvenWhenDatesConflict() {
  val records=listOf(episode(1,"1","第1话 开始与结束","1989-04-15"),episode(2,"13","第13话 另一集","2026-01-08"))
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,13,"开始与结束"){records}
  assertEquals(1,match!!.episode.getInt("episodeId"))
  assertEquals(2,DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,13,"不同的标题"){records}!!.episode.getInt("episodeId"))
 }
 @Test fun duplicateTitlesCannotBeResolvedByNumberOrDate() {
  val records=listOf(episode(1,"1","第1话 开始与结束","2026-01-08"),episode(2,"2","第2话 开始与结束","1989-04-15"))
  assertNull(resolve(records))
 }
 @Test fun duplicateNumberWithoutMatchingTitleRemainsAmbiguous() {
  assertNull(resolve(listOf(episode(1,"1","第1话 Story one"),episode(2,"1","第1话 Story two"))))
 }
 @Test fun identicalRepeatedEpisodeRecordsAreOneCandidate() {
  val record=episode(1,"1","第1话 开始与结束")
  assertEquals(1,resolve(listOf(record,record))!!.episode.getInt("episodeId"))
 }
 @Test fun uniqueTitleDoesNotCrossSeasonsOrUnrelatedWorks() {
  val records=listOf(episode(1,"1","第1话 开始与结束"))
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",2,1,"开始与结束"){records})
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"另一部作品")),"作品",1,1,"开始与结束"){records})
 }
 @Test fun aMatchingDateAloneCannotIdentifyAnEpisode() {
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,25,"其他标题"){
   listOf(episode(1,"1","第1话 开始与结束","2026-01-08"))
  })
 }
 @Test fun numericThemeRowsAreNotRegularEpisodes() {
  assertNull(resolve(listOf(episode(1,"1","OP1 Opening"),episode(2,"1","ED Ending"),episode(3,"1","Music video"))))
 }
 @Test fun equallyMatchingDifferentReleasesRemainAmbiguous() {
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品"),anime(2,"作品")),"作品",1,1,"开始与结束"){
   listOf(episode(it.getInt("bangumiId"),"1","第1话 开始与结束"))
  })
 }
 @Test fun aFailedAlternativeDoesNotDiscardAUsableMatch() {
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品"),anime(2,"作品")),"作品",1,1,"开始与结束"){
   if(it.getInt("bangumiId")==1) error("provider unavailable")
   listOf(episode(2,"1","第1话 开始与结束","2026-01-09"))
  }
  assertEquals(2,match!!.episode.getInt("episodeId"))
 }
 @Test fun cancellationDuringReleaseFetchCannotReturnAnOldMatch() {
  var current=true
  assertNull(DanmakuMatch.resolve(listOf(anime(1,"作品")),"作品",1,1,"开始与结束",isCurrent={current}){
   current=false;listOf(episode(1,"1","第1话 开始与结束","2026-01-09"))
  })
 }
 @Test fun rememberedManualReleaseOutranksOtherwiseEquivalentCandidates() {
  val match=DanmakuMatch.resolve(listOf(anime(1,"作品"),anime(2,"作品")),"作品",1,1,"开始与结束",savedBangumi="2"){
   listOf(episode(it.getInt("bangumiId"),"1","第1话 开始与结束","2026-01-09"))
  }
  assertEquals(2,match!!.anime.getInt("bangumiId"))
 }
}
