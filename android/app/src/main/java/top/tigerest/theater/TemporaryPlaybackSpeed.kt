package top.tigerest.theater

class TemporaryPlaybackSpeed {
    private var previous: Double? = null
    val active: Boolean get() = previous != null

    fun begin(currentSpeed: Double): Double? {
        if (active) return null
        previous = currentSpeed
        return maxOf(2.0, currentSpeed)
    }

    fun end(): Double? {
        val restored = previous
        previous = null
        return restored
    }
}
