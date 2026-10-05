package top.tigerest.theater

data class DanmakuComment(val time: Double, val text: String, val mode: Int, val color: Int)
class DanmakuTimeline(comments: List<DanmakuComment>) {
    private val ordered = comments.filter { it.time.isFinite() && it.time >= 0 && it.text.isNotBlank() }.sortedBy { it.time }
    fun visible(position: Double, duration: Double, delay: Double): List<DanmakuComment> {
        val time = position - delay
        val end = upperBound(time)
        val start = upperBound(time - duration.coerceAtLeast(0.1))
        return ordered.subList(start, end)
    }
    private fun upperBound(time: Double): Int {
        var lo = 0; var hi = ordered.size
        while (lo < hi) { val mid = (lo + hi) / 2; if (ordered[mid].time <= time) lo = mid + 1 else hi = mid }
        return lo
    }
}
