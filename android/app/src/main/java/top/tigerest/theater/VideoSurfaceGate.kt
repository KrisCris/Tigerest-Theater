package top.tigerest.theater

/**
 * mpv opens its video output when a file starts, and on Android that output needs the
 * SurfaceView's surface, which exists only once the shown view has been laid out. A video
 * started before then fails with "Missing surface pointer" and mpv deselects its video
 * track for good. A video load therefore waits for the surface; audio starts at once.
 * Only the latest load waits: a newer load or a stop drops it.
 */
class VideoSurfaceGate(private val start: (generation: Long, url: String) -> Unit) {
    private var waiting: Pair<Long, String>? = null
    var hasSurface = false; private set

    /** Starts the load, or holds a video until the surface is attached. False when held. */
    fun load(generation: Long, url: String, video: Boolean): Boolean {
        waiting = null
        if (video && !hasSurface) { waiting = generation to url; return false }
        start(generation, url)
        return true
    }

    fun cancel() { waiting = null }

    /** A surface mounted again keeps the playing file; it only starts a held load. */
    fun attached() {
        hasSurface = true
        val load = waiting ?: return
        waiting = null
        start(load.first, load.second)
    }

    fun detached() { hasSurface = false }
}
