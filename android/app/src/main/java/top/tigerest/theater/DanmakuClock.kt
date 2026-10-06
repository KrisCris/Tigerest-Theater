package top.tigerest.theater

import kotlin.math.abs

/** Interpolate the frame-quantized media clock, without advancing through a stalled source. */
class DanmakuClock {
    private var generation = Long.MIN_VALUE
    private var lastFrame = 0L
    private var lastSourceAt = 0L
    private var lastSource = 0.0
    private var position = 0.0
    private var running = false
    private var awaitingAdvance = true
    fun position(source: Double, nanos: Long, playing: Boolean, speed: Double, epoch: Long): Double {
        val raw = source.coerceAtLeast(0.0)
        val changed = abs(raw-lastSource)>.000001
        val discontinuity = raw<lastSource-.001 || abs(raw-lastSource)>maxOf(.5,speed*.3)
        if(generation!=epoch || !playing || !running || discontinuity || nanos-lastFrame>500_000_000L) {
            position = raw; lastSourceAt = nanos; awaitingAdvance = true
        } else if(awaitingAdvance) {
            // core-idle may clear before the first decoded frame after pause/seek.
            // Anchor interpolation to actual media movement, not that early state change.
            position = raw; lastSourceAt = nanos
            if(changed) awaitingAdvance = false
        } else {
            val dt = ((nanos-lastFrame)/1e9).coerceIn(0.0,.1)
            position += dt*speed
            // Correct phase gently; snapping to each new PTS reintroduces 24/30 fps stepping.
            if(changed) position += (raw-position).coerceIn(-.1,.1)*.08
            if(nanos-lastSourceAt>250_000_000L) position = minOf(position,lastSource+.25*speed)
        }
        if(changed) lastSourceAt = nanos
        lastSource = raw; lastFrame = nanos; generation = epoch; running = playing
        return position.coerceAtLeast(0.0)
    }
}
