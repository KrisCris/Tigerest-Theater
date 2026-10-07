package top.tigerest.theater

import android.app.AlertDialog
import android.content.Context
import android.media.AudioManager
import android.provider.Settings
import android.view.GestureDetector
import android.view.MotionEvent
import android.view.ViewConfiguration
import androidx.lifecycle.Lifecycle
import org.json.JSONArray
import kotlin.math.abs
import kotlin.math.roundToInt

/** Only receives touches starting on the video, never the controls or system edges. */
class PlayerGestures(private val activity: MainActivity,private val player: PlaybackController,
    private val singleTap: () -> Unit,private val feedback: (String) -> Unit) {
    private enum class Axis { NONE, SEEK, VOLUME, BRIGHTNESS, SPEED }
    private val audio = activity.getSystemService(AudioManager::class.java)
    private val preferences = activity.getSharedPreferences("player-ui",Context.MODE_PRIVATE)
    private var tutorial: AlertDialog? = null
    private var resumeTutorial = false
    private var axis = Axis.NONE
    private var eligible = false
    private var doubleTap = false
    private var startX = 0f; private var startY = 0f
    private var startPosition = 0L; private var duration = 0L; private var target = 0L
    private var startVolume = 0; private var startBrightness = .5f
    private var previousBrightness: Float? = null
    private var gestureGeneration = 0L
    private val detector = GestureDetector(activity,object: GestureDetector.SimpleOnGestureListener() {
        override fun onDown(event: MotionEvent) = true
        override fun onSingleTapConfirmed(event: MotionEvent): Boolean { singleTap(); return true }
        override fun onDoubleTap(event: MotionEvent): Boolean {
            doubleTap = true
            if(player.state.active) {
                val paused = player.isPaused(); player.dispatch(if(paused) "play" else "pause",JSONArray())
                feedback(if(paused) "播放" else "暂停")
            }
            return true
        }
        override fun onLongPress(event: MotionEvent) {
            if(!eligible || doubleTap || axis!=Axis.NONE || tutorial?.isShowing==true || player.state.generation!=gestureGeneration) return
            val speed = player.beginTemporarySpeed() ?: return
            axis = Axis.SPEED
            feedback("${speed.toString().removeSuffix(".0")}× 倍速播放\n松手恢复")
        }
    })
    fun volume() = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
    fun brightness() = activity.window.attributes.screenBrightness
    fun effectiveBrightness(): Float = brightness().takeIf { it>=0 } ?: (Settings.System.getInt(activity.contentResolver,Settings.System.SCREEN_BRIGHTNESS,128)/255f).coerceIn(.02f,1f)
    private fun setBrightness(value: Float) {
        if(previousBrightness==null) previousBrightness = brightness()
        activity.window.attributes = activity.window.attributes.apply { screenBrightness = value.coerceIn(.02f,1f) }
    }
    fun restoreBrightness() { previousBrightness?.let { activity.window.attributes = activity.window.attributes.apply { screenBrightness = it } }; previousBrightness = null }
    fun cancelTouch() {
        player.endTemporarySpeed()
        eligible=false;axis=Axis.NONE
        val now=android.os.SystemClock.uptimeMillis();val cancel=MotionEvent.obtain(now,now,MotionEvent.ACTION_CANCEL,0f,0f,0)
        detector.onTouchEvent(cancel);cancel.recycle();feedback("")
    }
    fun refreshPlayback() { if(axis==Axis.SPEED && !player.temporarySpeedActive) cancelTouch() }
    fun suspend() { resumeTutorial = false;cancelTouch();tutorial?.dismiss();restoreBrightness() }
    fun playbackStarted() { cancelTouch(); if(!preferences.getBoolean("gesturesTutorialSeen",false)) showTutorial() }
    fun showTutorial() {
        if(tutorial?.isShowing==true || activity.isFinishing) return
        cancelTouch()
        val generation = player.state.generation
        val pauseIntent = player.pauseIntent
        resumeTutorial = player.state.active && !player.isPaused()
        if(resumeTutorial) player.pauseForTutorial()
        tutorial = AlertDialog.Builder(activity).setTitle("播放手势")
            .setMessage("轻点画面：显示／隐藏控制栏\n\n双击画面：播放／暂停\n\n长按空白画面：临时 2× 播放，松手恢复原速度；原速度高于 2× 时保持原速度\n\n左右滑动：预览快进／快退，松手跳转\n\n左侧上下滑动：调整本次播放的亮度\n\n右侧上下滑动：调整媒体音量\n\n从画面内部开始操作，屏幕边缘留给系统手势。可在“更多 → 手势教程”再次查看。")
            .setPositiveButton("知道了",null).create()
        tutorial!!.setOnDismissListener {
            preferences.edit().putBoolean("gesturesTutorialSeen",true).apply(); tutorial = null
            if(resumeTutorial && player.pauseIntent==pauseIntent && player.state.active && player.state.generation==generation && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) player.dispatch("play",JSONArray())
            resumeTutorial = false
        }
        tutorial!!.show()
    }
    fun touch(event: MotionEvent,width: Int,height: Int,allowed: Boolean): Boolean {
        if(event.actionMasked==MotionEvent.ACTION_DOWN) {
            player.endTemporarySpeed()
            eligible = allowed && player.state.active && tutorial?.isShowing!=true; axis = Axis.NONE; doubleTap = false
            if(!eligible) return true
            startX = event.x; startY = event.y; startPosition = (player.positionSeconds()*1000).toLong()
            duration = player.dispatch("getDuration",JSONArray()) as Long; target = startPosition
            startVolume = volume(); startBrightness = effectiveBrightness(); gestureGeneration = player.state.generation
        }
        if(!eligible) return true
        if(event.pointerCount>1 || player.state.generation!=gestureGeneration || !player.state.active) { cancelTouch(); return true }
        if(event.actionMasked==MotionEvent.ACTION_CANCEL) { cancelTouch(); return true }
        if(event.actionMasked==MotionEvent.ACTION_MOVE) {
            val dx = event.x-startX; val dy = event.y-startY
            if(axis==Axis.NONE) {
                val threshold = ViewConfiguration.get(activity).scaledTouchSlop*1.5f
                if(maxOf(abs(dx),abs(dy))>threshold) {
                    // Movement, including an undecided diagonal, disqualifies a stationary hold.
                    cancelDetector(event)
                    axis = if(abs(dx)>abs(dy)*1.2f) Axis.SEEK else if(abs(dy)>abs(dx)*1.2f) { if(startX<width/2) Axis.BRIGHTNESS else Axis.VOLUME } else Axis.NONE
                }
            }
            when(axis) {
                Axis.SEEK -> {
                    if(duration<=0) feedback("此视频暂不支持滑动跳转") else {
                        target = (startPosition+dx/width.coerceAtLeast(1)*minOf(duration,90_000L)).toLong().coerceIn(0,duration)
                        val delta = (target-startPosition)/1000
                        feedback("${if(delta>=0) "快进" else "快退"} ${abs(delta)} 秒\n${format(target)} / ${format(duration)}")
                    }
                }
                Axis.VOLUME -> {
                    val maximum = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    val next = (startVolume-dy/height.coerceAtLeast(1)*maximum*2).roundToInt().coerceIn(0,maximum)
                    audio.setStreamVolume(AudioManager.STREAM_MUSIC,next,0)
                    feedback("音量 ${(volume()*100f/maximum.coerceAtLeast(1)).roundToInt()}%")
                }
                Axis.BRIGHTNESS -> { setBrightness(startBrightness-dy/height.coerceAtLeast(1)*2); feedback("亮度 ${(brightness()*100).roundToInt()}%") }
                Axis.NONE, Axis.SPEED -> Unit
            }
        }
        if(axis==Axis.NONE) detector.onTouchEvent(event)
        if(event.actionMasked==MotionEvent.ACTION_UP) {
            if(axis==Axis.SEEK && duration>0) player.dispatch("seekTo",JSONArray().put(target))
            if(axis==Axis.SPEED) { player.endTemporarySpeed(); cancelDetector(event); feedback("") }
            eligible = false; axis = Axis.NONE
        }
        return true
    }
    private fun cancelDetector(event: MotionEvent) { val cancel=MotionEvent.obtain(event);cancel.action=MotionEvent.ACTION_CANCEL;detector.onTouchEvent(cancel);cancel.recycle() }
    private fun format(ms: Long): String { val seconds=ms/1000;return "%d:%02d".format(seconds/60,seconds%60) }
}
