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
    /** mpv `video-params` / `video-target-params` fields the dynamic range notice reads. */
    data class ColorParams(val width: Int = 0, val height: Int = 0, val primaries: String = "", val gamma: String = "", val maxLuma: Double = 0.0)
    /**
     * The playback-start notice: HDR or SDR output, from what source. Same rules
     * and wording as the Apple clients (DynamicRangeSummary.swift); null until
     * both colorspaces are known.
     */
    fun dynamicRangeText(source: ColorParams, target: ColorParams, dolbyVisionProfile: Int, toneMapping: String): String? {
        if(source.gamma.isEmpty() || target.gamma.isEmpty()) return null
        val hdr = setOf("pq","hlg"); val sourceHdr = source.gamma in hdr; val targetHdr = target.gamma in hdr
        val format = if(dolbyVisionProfile > 0) "杜比视界 Profile $dolbyVisionProfile" else if(source.gamma == "hlg") "HLG" else "HDR10"
        val mode = if(targetHdr) "HDR 输出 · $format"
            else if(sourceHdr) "SDR 输出 · $format 已色调映射（${toneMapping.ifEmpty { "自动" }}）"
            else "SDR 播放"
        val input = mutableListOf<String>()
        if(source.width > 0 && source.height > 0) input += "${source.width}×${source.height}"
        input += colorspace(source)
        // Mastering peaks are coded with small offsets (1000.6); report them in 10-nit steps.
        // MediaCodec hands mpv no mastering metadata, and mpv then reports PQ's 10000-nit ceiling.
        if(sourceHdr && source.maxLuma.isFinite() && source.maxLuma > 0 && source.maxLuma < 10000) input += "母版 ${Math.round(source.maxLuma/10)*10} nits"
        // A PQ target's max-luma is the signal's ceiling, not the screen's.
        val output = mutableListOf(colorspace(target)); if(targetHdr) output += "由系统按屏幕能力映射亮度"
        return "$mode\n片源 ${input.joinToString(" · ")}\n输出 ${output.joinToString(" · ")}"
    }
    private fun colorspace(params: ColorParams): String {
        val primaries = mapOf("bt.709" to "BT.709","bt.2020" to "BT.2020","display-p3" to "Display P3","dci-p3" to "DCI-P3",
            "bt.601-525" to "BT.601","bt.601-625" to "BT.601","apple" to "Apple RGB","adobe" to "Adobe RGB")[params.primaries]
            ?: params.primaries.uppercase().ifEmpty { "未知" }
        val transfer = mapOf("pq" to "PQ","hlg" to "HLG","srgb" to "sRGB","bt.1886" to "BT.1886","gamma2.2" to "Gamma 2.2",
            "gamma2.4" to "Gamma 2.4","linear" to "线性")[params.gamma] ?: params.gamma.ifEmpty { "未知" }
        return "$primaries / $transfer"
    }
}
