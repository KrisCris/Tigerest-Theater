package top.tigerest.theater

class PlaybackState {
    var opening = false; private set
    private var waitingForCache = false
    val loading: Boolean get() = active && (opening || waitingForCache && !paused)
    fun ready(generation: Long) { if (generation == this.generation && active) opening = false }
    fun buffering(generation: Long, waiting: Boolean) { if (generation == this.generation && active) waitingForCache = waiting }
    var active = false; private set
    var paused = false; private set
    var positionMs = 0L; private set
    var generation = 0L; private set
    var url = ""; private set
    var speed = 1.0; private set
    fun begin(url: String): Long { this.url = url; generation++; active = true; opening = true; waitingForCache = false; positionMs = 0; paused = false; return generation }
    fun end(generation: Long): Boolean { if (generation != this.generation || !active) return false; active = false; opening = false; waitingForCache = false; return true }
    fun update(generation: Long, seconds: Double, paused: Boolean, speed: Double) {
        if (generation != this.generation || !active) return
        positionMs = (seconds.coerceAtLeast(0.0) * 1000).toLong()
        this.paused = paused; this.speed = speed
    }
}
