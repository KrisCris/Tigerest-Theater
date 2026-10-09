package top.tigerest.theater

import org.json.JSONArray
import org.json.JSONObject

data class EpisodeEntry(val id: String, val label: String)
data class EpisodeQueue(val items: List<EpisodeEntry>, val currentIndex: Int) {
    val previousId get() = if(currentIndex > 0) items[currentIndex-1].id else null
    val nextId get() = if(currentIndex >= 0) items.getOrNull(currentIndex+1)?.id else null

    companion object {
        fun currentIdFor(raw: JSONArray, item: JSONObject): String {
            val entries = (0 until raw.length()).mapNotNull { raw.optJSONObject(it) }
            val explicit = item.optString("PlaylistItemId")
            if(explicit.isNotBlank() && entries.any { it.optString("PlaylistItemId") == explicit }) return explicit
            val mediaId = item.optString("Id")
            if(mediaId.isBlank()) return ""
            return entries.filter { it.optString("Id") == mediaId }.singleOrNull()?.optString("PlaylistItemId") ?: ""
        }
        fun from(raw: JSONArray, currentId: String): EpisodeQueue {
            val items = (0 until raw.length()).mapNotNull { index ->
                val item = raw.optJSONObject(index) ?: return@mapNotNull null
                val id = item.optString("PlaylistItemId").takeIf { it.isNotBlank() } ?: return@mapNotNull null
                val episode = if(item.has("IndexNumber")) "S${item.optInt("ParentIndexNumber",1)} E${item.optInt("IndexNumber")}" else ""
                EpisodeEntry(id, listOf(episode,item.optString("Name")).filter { it.isNotBlank() }.joinToString(" · ").ifBlank { "第 ${index+1} 项" })
            }
            return EpisodeQueue(items,items.indexOfFirst { it.id == currentId })
        }
    }
}
