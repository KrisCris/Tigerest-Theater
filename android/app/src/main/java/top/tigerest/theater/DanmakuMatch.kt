package top.tigerest.theater

import org.json.JSONObject
import java.time.LocalDate
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max

object DanmakuMatch {
    data class Selection(val anime: JSONObject,val episode: JSONObject,val dateDistance: Long?)
    private data class Work(val anime: JSONObject,val score: Double)
    private data class Candidate(val selection: Selection,val workScore: Double,val episodeScore: Double,val key: String)
    private val special = Regex("(?i)(OVA|OAD|\\bSP\\b|special|特别篇|特別篇|番外)")
    private val seasons = listOf("零","一","二","三","四","五","六","七","八","九","十")

    fun select(results: List<JSONObject>,title: String,season: Int): JSONObject? = rankedWorks(results,title,season,null).firstOrNull()?.anime

    fun resolve(results: List<JSONObject>,title: String,season: Int,number: Int,premiere: String,name: String,
                savedBangumi: String? = null,isCurrent: () -> Boolean = {true},
                fetchEpisodes: (JSONObject) -> List<JSONObject>): Selection? {
        val day = day(premiere)
        val expectedTitle = episodeTitle(name)
        val nearby = mutableListOf<Candidate>()
        for(work in rankedWorks(results,title,season,savedBangumi)) {
            if(!isCurrent()) return null
            val records = runCatching { fetchEpisodes(work.anime) }.getOrDefault(emptyList())
            if(!isCurrent()) return null
            val regular = records.filter { record ->
                record.optString("episodeNumber").toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true &&
                    record.optString("episodeId").matches(Regex("[0-9]{1,32}")) && record.optString("episodeTitle").isNotBlank()
            }
            fun candidate(record: JSONObject): Candidate {
                val airDay = day(record.optString("airDate"))
                return Candidate(Selection(work.anime,record,if(day!=null && airDay!=null) abs(day-airDay) else null),
                    work.score,if(expectedTitle.isEmpty()) 0.0 else similarity(expectedTitle,episodeTitle(record.optString("episodeTitle"))),
                    work.anime.optString("bangumiId")+"\u0000"+record.optString("episodeId"))
            }
            val dated = if(day==null) emptyList() else regular.filter { day(it.optString("airDate")) == day }
            val titled = dated.filter { expectedTitle.isNotEmpty() && episodeTitle(it.optString("episodeTitle")) == expectedTitle }
            val supported = (if(titled.isNotEmpty()) titled else dated).filter { episodeNumber(it)==number.toDouble() }
                .ifEmpty { titled }.ifEmpty { if(dated.size==1) dated else emptyList() }
            if(supported.isNotEmpty()) return supported.map(::candidate).sortedWith(candidateOrder).first().selection
            for(record in regular) {
                val c = candidate(record)
                if(c.selection.dateDistance != null && c.selection.dateDistance > 7) continue
                if(episodeNumber(record)==number.toDouble() || (number<0 && regular.size==1)) nearby += c
            }
        }
        return if(isCurrent()) nearby.sortedWith(candidateOrder).firstOrNull()?.selection else null
    }

    private val candidateOrder = compareByDescending<Candidate> { it.workScore }
        .thenByDescending { it.episodeScore }.thenBy { it.selection.dateDistance ?: Long.MAX_VALUE }.thenBy { it.key }
    private fun episodeNumber(record: JSONObject) = record.optString("episodeNumber").toDoubleOrNull()
    private fun episodeTitle(value: String) = normalize(value.replace(Regex("^第\\s*\\d+\\s*[话話集]\\s*"),""))
    private fun day(value: String): Long? = runCatching {
        val date=value.take(10)
        if(!Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}").matches(date) || date.take(4).toInt()<1) return null
        LocalDate.parse(date).toEpochDay()
    }.getOrNull()
    private fun normalize(value: String): String = buildString {
        value.codePoints().filter { Character.isLetterOrDigit(it) }.forEach { appendCodePoint(it) }
    }.lowercase(Locale.ROOT)

    private fun rankedWorks(results: List<JSONObject>,title: String,season: Int,saved: String?): List<Work> {
        val base=normalize(title)
        if(base.isEmpty()) return emptyList()
        return results.mapNotNull { anime ->
            val id=anime.optString("bangumiId")
            if(!id.matches(Regex("(?:[0-9]+|tmdb-[A-Za-z0-9-]+)")) || id.length>100) return@mapNotNull null
            val raw=anime.optString("animeTitle")
            val candidate=normalize(raw)
            if(candidate.isEmpty()) return@mapNotNull null
            // A user's remembered release outranks inferred title similarities.
            if(id==saved) return@mapNotNull Work(anime,2.0)
            if(season==0 && !special.containsMatchIn(raw)) return@mapNotNull null
            if(season>0 && special.containsMatchIn(raw) && !special.containsMatchIn(title)) return@mapNotNull null
            val suffix=if(candidate.startsWith(base)) candidate.removePrefix(base) else ""
            val explicit=season>0 && (suffix=="第${season}季" || suffix=="第${seasons.getOrNull(season)}季" ||
                suffix=="season$season" || suffix=="s$season" || suffix=="${season}ndseason" || suffix=="${season}rdseason")
            // Keep the existing sequel/special evidence guard when no manual release is saved.
            if(season>1 && !explicit) return@mapNotNull null
            if(season==1 && Regex("第[二三四五六七八九十2-9][季部]|season[2-9]|s[2-9]").containsMatchIn(suffix)) return@mapNotNull null
            val score=if(explicit) 1.0 else similarity(base,candidate)
            if(score>=0.75) Work(anime,score) else null
        }.sortedWith(compareByDescending<Work> { it.anime.optString("bangumiId")==saved }
            .thenByDescending { it.score }.thenBy { it.anime.optString("bangumiId") })
    }

    private fun similarity(a: String,b: String): Double {
        if(a==b) return 1.0
        if(a.isEmpty() || b.isEmpty()) return 0.0
        val radius=max(a.length,b.length).div(2).minus(1).coerceAtLeast(0)
        val am=BooleanArray(a.length);val bm=BooleanArray(b.length)
        var count=0
        for(i in a.indices) for(j in max(0,i-radius)..minOf(b.lastIndex,i+radius)) {
            if(!bm[j] && a[i]==b[j]) {am[i]=true;bm[j]=true;count++;break}
        }
        if(count==0) return 0.0
        val left=a.indices.filter { am[it] }.map { a[it] };val right=b.indices.filter { bm[it] }.map { b[it] }
        val transpositions=left.indices.count { left[it]!=right[it] }/2.0
        val jaro=(count.toDouble()/a.length+count.toDouble()/b.length+(count-transpositions)/count)/3
        val prefix=a.zip(b).take(4).takeWhile { it.first==it.second }.size
        return (if(jaro>0.7) jaro+prefix*0.1*(1-jaro) else jaro).coerceIn(0.0,1.0)
    }
}
