package top.tigerest.theater

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.view.Choreographer
import android.view.View

class DanmakuOverlay(context: Context,private val settings: SettingsStore,private val player: PlaybackController,private val repository: DanmakuRepository): View(context),Choreographer.FrameCallback {
    private data class Glyph(val comment: DanmakuComment,val lane: Int,val width: Float,val start: Double)
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private var glyphs = emptyList<Glyph>()
    private var size = 0f
    private var rowHeight = 0f
    private var duration = 15.0
    private var frameTime = 0L
    var drawnFrames = 0L; private set
    var motionFrames = 0L; private set
    var renderedPosition = 0.0; private set
    fun rebuild() {
        size = (settings.number("danmaku","fontsize") * resources.displayMetrics.density * 0.52).toFloat().coerceIn(12f,120f)
        duration = settings.number("danmaku","scrolltime").coerceIn(2.0,40.0)
        paint.textSize = size; paint.typeface = if(settings.bool("danmaku","bold")) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        rowHeight = size*1.35f
        val contentHeight = (height-200*resources.displayMetrics.density).coerceAtLeast(rowHeight)
        val rows = (contentHeight*settings.number("danmaku","displayarea")/rowHeight).toInt().coerceAtLeast(1)
        val scheduled = mutableListOf<Glyph>()
        val available = Array(3) { DoubleArray(rows) { Double.NEGATIVE_INFINITY } }
        val merged = repository.sources.filter { it.enabled }.flatMap { source -> source.comments.map { it to (it.time+source.delay) } }.sortedBy { it.second }.take(50000)
        for((comment,start) in merged) {
                val mode = when(comment.mode){5->1;4->2;else->0}
                val lane = available[mode].indexOfFirst { it <= start }
                if(lane < 0) continue
                available[mode][lane] = start + if(mode == 0) duration else 5.0
                scheduled += Glyph(comment,lane,paint.measureText(comment.text),start)
        }
        glyphs = scheduled; invalidate()
    }
    override fun onSizeChanged(w: Int,h: Int,oldw: Int,oldh: Int) { rebuild() }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); Choreographer.getInstance().postFrameCallback(this) }
    override fun onDetachedFromWindow() { Choreographer.getInstance().removeFrameCallback(this); super.onDetachedFromWindow() }
    override fun doFrame(frameTimeNanos: Long) { if(isAttachedToWindow){ frameTime = frameTimeNanos; if(isShown && player.state.active && settings.bool("mpv","enableDanmaku")) invalidate(); Choreographer.getInstance().postFrameCallback(this) } }
    override fun onDraw(canvas: Canvas) {
        if(!settings.bool("mpv","enableDanmaku")) return
        val position = player.danmakuPosition(if(frameTime>0) frameTime else System.nanoTime()); var count = 0; var scrolling = false
        paint.alpha = (settings.number("danmaku","opacity")*255).toInt().coerceIn(0,255)
        var lo = 0; var hi = glyphs.size
        val oldest = position-maxOf(duration,5.0)
        while(lo<hi) { val mid = (lo+hi)/2; if(glyphs[mid].start<oldest) lo=mid+1 else hi=mid }
        for(index in lo until glyphs.size) {
            val glyph = glyphs[index]; if(glyph.start>position) break
            val comment = glyph.comment; val elapsed = position-glyph.start
            val lifetime = if(comment.mode == 4 || comment.mode == 5) 5.0 else duration
            if(elapsed < 0 || elapsed >= lifetime) continue
            if(count++ >= 180) break
            if(comment.mode != 4 && comment.mode != 5) scrolling = true
            val x = if(comment.mode == 4 || comment.mode == 5) (width-glyph.width)/2 else (width-(width+glyph.width)*elapsed/duration).toFloat()
            val y = if(comment.mode == 4) height-(glyph.lane+1)*rowHeight-136*resources.displayMetrics.density else (glyph.lane+1)*rowHeight+64*resources.displayMetrics.density
            paint.style = Paint.Style.STROKE; paint.strokeWidth = (settings.number("danmaku","outline")*resources.displayMetrics.density).toFloat(); paint.color = android.graphics.Color.BLACK
            val opacity = (settings.number("danmaku","opacity")*255).toInt().coerceIn(0,255); paint.alpha = opacity
            val shadow = settings.number("danmaku","shadow").toFloat(); if(shadow > 0) paint.setShadowLayer(shadow,1f,1f,android.graphics.Color.BLACK) else paint.clearShadowLayer()
            canvas.drawText(comment.text,x,y,paint); paint.style = Paint.Style.FILL; paint.color = comment.color or (0xff shl 24); paint.alpha = opacity; canvas.drawText(comment.text,x,y,paint)
        }
        if(scrolling && kotlin.math.abs(position-renderedPosition)>.00001) motionFrames++
        renderedPosition = position; drawnFrames++
    }
}
