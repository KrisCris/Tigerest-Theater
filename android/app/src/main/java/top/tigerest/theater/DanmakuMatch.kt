package top.tigerest.theater
import org.json.JSONObject
object DanmakuMatch {
    fun select(results: List<JSONObject>, title: String, season: Int): JSONObject? {
        val base = title.replace(Regex("\\s+"),"")
        val chinese = listOf("零","一","二","三","四","五","六","七","八","九","十")
        val explicit = results.filter {
            val candidate = it.optString("animeTitle").replace(Regex("\\s+"),"")
            if(!candidate.startsWith(base)) false
            else if(season == 0) Regex("(?i)(OVA|OAD|SP|special|特别篇|特別篇|番外)").containsMatchIn(candidate.removePrefix(base))
            else {
                val suffix = candidate.removePrefix(base)
                suffix == "第${season}季" || suffix == "第${chinese.getOrNull(season)}季" ||
                    suffix.equals("season$season",true) || suffix.equals("s$season",true) || suffix == "${season}ndSeason" || suffix == "${season}rdSeason"
            }
        }
        if(explicit.size == 1) return explicit.single()
        if(season <= 1 && season != 0) return results.singleOrNull { it.optString("animeTitle").replace(Regex("\\s+"),"") == base }
        // Never silently use a base-title first season for sequels or specials.
        return null
    }
}
