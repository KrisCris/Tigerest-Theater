package top.tigerest.theater

import org.json.JSONObject
import java.util.Locale
import kotlin.math.max

object DanmakuMatch {
    data class Selection(val anime: JSONObject,val episode: JSONObject,val matchedByTitle: Boolean)
    private data class Work(val anime: JSONObject,val score: Double)
    private data class Candidate(val selection: Selection,val workScore: Double,val key: String)
    private val special = Regex("(?i)(OVA|OAD|\\bSP\\b|special|特别篇|特別篇|番外)")
    private val seasons = listOf("零","一","二","三","四","五","六","七","八","九")
    private val seasonWords = listOf("first","second","third","fourth","fifth","sixth","seventh","eighth","ninth","tenth")

    fun select(results: List<JSONObject>,title: String,season: Int): JSONObject? = rankedWorks(results,title,season,null).firstOrNull()?.anime

    fun resolve(results: List<JSONObject>,title: String,season: Int,number: Int,name: String,
                savedBangumi: String? = null,isCurrent: () -> Boolean = {true},
                fetchEpisodes: (JSONObject) -> List<JSONObject>): Selection? {
        val expectedTitle = episodeTitle(name)
        val candidates = mutableListOf<Candidate>()
        for(work in rankedWorks(results,title,season,savedBangumi)) {
            if(!isCurrent()) return null
            val records = runCatching { fetchEpisodes(work.anime) }.getOrDefault(emptyList())
            if(!isCurrent()) return null
            val regular = records.filter { record ->
                record.optString("episodeNumber").toDoubleOrNull()?.let { it.isFinite() && it >= 0 } == true &&
                    record.optString("episodeId").matches(Regex("[0-9]{1,32}")) && record.optString("episodeTitle").isNotBlank() &&
                    !creditEpisode(record)
            }.distinctBy { it.optString("episodeId") }
            val titled = regular.filter { expectedTitle.isNotEmpty() && episodeTitle(it.optString("episodeTitle")) == expectedTitle }
            val byTitle = titled.isNotEmpty()
            // Duplicate titles stay ambiguous; a number cannot override the title match.
            val supported = if(byTitle) titled else regular.filter { episodeNumber(it)==number.toDouble() }
            for(record in supported) {
                candidates += Candidate(Selection(work.anime,record,byTitle),work.score,
                    work.anime.optString("bangumiId")+"\u0000"+record.optString("episodeId"))
            }
        }
        if(!isCurrent()) return null
        val unique = candidates.distinctBy { it.key }
        val bestScore = unique.maxOfOrNull { it.workScore } ?: return null
        val bestWork = unique.filter { it.workScore==bestScore }
        val best = bestWork.filter { it.selection.matchedByTitle }.ifEmpty { bestWork }
        return best.singleOrNull()?.selection
    }

    private fun episodeNumber(record: JSONObject) = record.optString("episodeNumber").toDoubleOrNull()
    private fun episodeTitle(value: String): String {
        val title=normalize(value.replace(Regex("^第\\s*\\d+\\s*[话話集]\\s*"),""))
        return if(Regex("(?:episode|ep)?[0-9]+").matches(title)) "" else title
    }
    private fun creditEpisode(record: JSONObject): Boolean {
        val title=episodeTitle(record.optString("episodeTitle"))
        return title in listOf("op","ed","opening","ending") ||
            Regex("^(?:op[0-9]+|ed[0-9]+|ncop|nced|opopening|edending|optheme|edtheme|openingtheme|endingtheme|openingcredits|endingcredits|musicvideo|片头曲|片尾曲|主题曲|主題曲)").containsMatchIn(title)
    }
    private fun normalize(value: String): String = buildString {
        value.replace("½","1/2").codePoints().filter { Character.isLetterOrDigit(it) }.forEach { appendCodePoint(it) }
    }.lowercase(Locale.ROOT)

    private fun workTitleAndSeason(value: String): Pair<String,Int?> {
        val title=normalize(value)
        // Match longer numeric ordinals before their shorter suffixes (11th/1th).
        for(index in 99 downTo 1) {
            val chinese=if(index<10) seasons[index] else (if(index>=20) seasons[index/10] else "")+"十"+(if(index%10>0) seasons[index%10] else "")
            val suffixes=listOf("第${index}季","第${chinese}季","第${index}部","第${chinese}部","season$index","s$index","s${index.toString().padStart(2,'0')}",
                "${index}stseason","${index}ndseason","${index}rdseason","${index}thseason")+listOfNotNull(seasonWords.getOrNull(index-1)?.plus("season"))
            val suffix=suffixes.firstOrNull { title.length>it.length && title.endsWith(it) }
            if(suffix!=null) return title.dropLast(suffix.length) to index
        }
        return title to null
    }

    private fun rankedWorks(results: List<JSONObject>,title: String,season: Int,saved: String?): List<Work> {
        val (base,querySeason)=workTitleAndSeason(title)
        if(base.isEmpty()) return emptyList()
        return results.mapNotNull { anime ->
            val id=anime.optString("bangumiId")
            if(!id.matches(Regex("(?:[0-9]+|tmdb-[A-Za-z0-9-]+)")) || id.length>100) return@mapNotNull null
            val raw=anime.optString("animeTitle").trim().replace(Regex("\\s*\\([^)]*\\)\\s*$|\\s*【[^】]*】.*$"),"")
            val (candidate,explicitSeason)=workTitleAndSeason(raw)
            if(candidate.isEmpty()) return@mapNotNull null
            // A user's remembered release outranks inferred title similarities.
            if(id==saved) return@mapNotNull Work(anime,2.0)
            if(querySeason!=null && season>0 && querySeason!=season) return@mapNotNull null
            if(season==0 && !special.containsMatchIn(raw)) return@mapNotNull null
            if(season>0 && special.containsMatchIn(raw) && !special.containsMatchIn(title)) return@mapNotNull null
            if(explicitSeason!=null && season>0 && explicitSeason!=season) return@mapNotNull null
            if(season>1 && explicitSeason!=season) return@mapNotNull null
            val explicitSpecial=season==0 && normalize(raw.replace(special,""))==base
            val score=if((explicitSeason!=null && candidate==base) || explicitSpecial) 1.0 else similarity(base,candidate)
            if(score>=0.85) Work(anime,score) else null
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
