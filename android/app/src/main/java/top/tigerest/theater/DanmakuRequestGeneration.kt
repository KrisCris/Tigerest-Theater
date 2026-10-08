package top.tigerest.theater

/** Playback changes and explicit choices both own a new request generation. */
class DanmakuRequestGeneration {
    @Volatile private var token = 0L
    @Synchronized fun playbackChanged(): Long = ++token
    @Synchronized fun manualSelection(expected: Long): Long? = if(expected == token) ++token else null
    fun currentToken(): Long = token
    fun isCurrent(expected: Long): Boolean = expected == token
}
