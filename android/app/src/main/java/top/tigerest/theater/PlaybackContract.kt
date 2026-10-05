package top.tigerest.theater

/** The shared Emby player uses music, #1 and an empty subtitle selection. */
object PlaybackContract {
    fun isVideo(type: String) = type.lowercase() !in setOf("audio","music")
    fun track(value: String): String {
        val normalized = value.removePrefix("#")
        return if(normalized.isBlank() || normalized.toIntOrNull()?.let { it < 0 } == true) "no" else normalized
    }
    fun subtitleBackground(color: String, alpha: String) = "#" + alpha + color.removePrefix("#")
}
