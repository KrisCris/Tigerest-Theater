package top.tigerest.theater

/** The shared Emby player uses music, #1 and an empty subtitle selection. */
object PlaybackContract {
    fun isVideo(type: String) = type.lowercase() !in setOf("audio","music")
    fun track(value: String): String {
        val normalized = value.removePrefix("#")
        return if(normalized.isBlank() || normalized.toIntOrNull()?.let { it < 0 } == true) "no" else normalized
    }
    fun subtitleBackground(color: String, alpha: String) = "#" + alpha + color.removePrefix("#")
    /** Bitmap subtitles have no text for the HDR output's native subtitle layer. */
    fun isImageSubtitle(codec: String) = codec.lowercase() in setOf("hdmv_pgs_subtitle","dvd_subtitle","dvb_subtitle","xsub")
    data class Size(val width: Int, val height: Int)
    /** The largest box of the given aspect inside the pane. */
    fun fit(width: Int, height: Int, aspect: Double): Size =
        if(aspect <= 0 || width <= 0 || height <= 0) Size(width,height)
        else if(width.toDouble()/height > aspect) Size((height*aspect).toInt(),height)
        else Size(width,(width/aspect).toInt())
    /** mpv sizes subtitles in pixels of a 720-line frame; the overlay scales them with the visible video. */
    data class SubtitleStyle(val height: Int, val fontSize: Double, val borderSize: Double) {
        private val scale = height / 720f
        val textSize = (fontSize * scale).toFloat()
        val border = (borderSize * scale).toFloat()
        val verticalMargin = 22 * scale
        val sideMargin = 25 * scale
    }
}
