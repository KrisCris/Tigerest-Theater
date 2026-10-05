package top.tigerest.theater

import android.app.AlertDialog
import android.graphics.Color
import android.view.Gravity
import android.view.View
import android.view.MotionEvent
import android.widget.*
import org.json.JSONArray
import kotlin.concurrent.thread

class VideoControls(private val activity: MainActivity,private val player: PlaybackController,private val repository: DanmakuRepository) : FrameLayout(activity) {
    private val title = TextView(activity).apply { setTextColor(Color.WHITE); textSize = 17f; maxLines = 1 }
    private val time = TextView(activity).apply { setTextColor(Color.WHITE); textSize = 13f }
    private val pause = button("暂停") { player.dispatch(if(player.state.paused) "play" else "pause",JSONArray()) }
    private val seek = SeekBar(activity)
    private var dragging = false
    private val controls = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12),dp(8),dp(12),dp(12)); setBackgroundColor(0xc0181818.toInt()) }
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private lateinit var header: LinearLayout
    private var lastPaused = true
    private val hide = Runnable { if(!dragging && !player.state.paused) setControlsVisible(false) }
    private fun setControlsVisible(shown: Boolean) { header.visibility = if(shown) View.VISIBLE else View.GONE; controls.visibility = header.visibility }
    fun showControls() { setControlsVisible(true); handler.removeCallbacks(hide); if(!player.state.paused) handler.postDelayed(hide,3500) }
    fun controlsVisible() = controls.visibility == View.VISIBLE
    fun refreshMetrics() {
        header.layoutParams = (header.layoutParams as LayoutParams).apply { height = dp(64) }
        header.setPadding(dp(8),dp(8),dp(16),dp(8)); controls.setPadding(dp(12),dp(8),dp(12),dp(12))
        fun visit(view: View) { if(view is Button) { view.minWidth = dp(64); view.minHeight = dp(48) }; if(view is android.view.ViewGroup) for(index in 0 until view.childCount) visit(view.getChildAt(index)) }
        visit(this)
    }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if(event.action == MotionEvent.ACTION_DOWN) { handler.removeCallbacks(hide); if(controls.visibility == View.VISIBLE) handler.postDelayed(hide,3500) }
        return super.dispatchTouchEvent(event)
    }
    private val update = object: Runnable { override fun run() {
        if(!isAttachedToWindow) return
        if(lastPaused != player.state.paused) { lastPaused = player.state.paused; showControls() }
        val duration = player.dispatch("getDuration",JSONArray()) as Long
        val position = player.state.positionMs
        if(!dragging) { seek.max = (duration/1000).toInt().coerceAtLeast(1); seek.progress = (position/1000).toInt() }
        time.text = "${format(position)} / ${format(duration)}   ${player.state.speed}×"; pause.text = if(player.state.paused) "继续" else "暂停"
        handler.postDelayed(this,400)
    } }
    init {
        isClickable = true
        setOnClickListener { if(controls.visibility == View.VISIBLE) { handler.removeCallbacks(hide); setControlsVisible(false) } else showControls() }
        header = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8),dp(8),dp(16),dp(8)); setBackgroundColor(0x90101010.toInt()) }
        header.addView(button("返回") { player.dispatch("stop",JSONArray()); activity.endPlaybackSession() })
        header.addView(title,LinearLayout.LayoutParams(0,dp(48),1f))
        header.addView(button("全屏") { activity.setFullscreen(!activity.fullscreen) })
        addView(header,LayoutParams(LayoutParams.MATCH_PARENT,dp(64),Gravity.TOP))
        controls.addView(time); controls.addView(seek)
        seek.setOnSeekBarChangeListener(object: SeekBar.OnSeekBarChangeListener {
            override fun onStartTrackingTouch(bar: SeekBar) { dragging = true }
            override fun onStopTrackingTouch(bar: SeekBar) { dragging = false; player.dispatch("seekTo",JSONArray().put(bar.progress*1000L)) }
            override fun onProgressChanged(bar: SeekBar,progress: Int,fromUser: Boolean) { if(fromUser) time.text = format(progress*1000L) }
        })
        val scroll = HorizontalScrollView(activity).apply { isHorizontalScrollBarEnabled = false }
        val actions = LinearLayout(activity).apply { gravity = Gravity.CENTER_VERTICAL }
        actions.addView(pause)
        actions.addView(button("前一集") { activity.input("previous") })
        actions.addView(button("下一集") { activity.input("next") })
        actions.addView(button("倍速") { val values = doubleArrayOf(.5,.75,1.0,1.25,1.5,1.75,2.0,2.5,3.0,4.0); AlertDialog.Builder(activity).setTitle("播放速度").setItems(values.map { "$it×" }.toTypedArray()) { _,index -> player.dispatch("setPlaybackRate",JSONArray().put(values[index]*1000)) }.show() })
        actions.addView(button("音轨") { tracks("audio") }); actions.addView(button("字幕") { tracks("sub") })
        actions.addView(button("字幕偏移") { subtitleOffset() })
        actions.addView(button("画质") { val rates = longArrayOf(0,4000000,8000000,15000000,25000000,40000000); AlertDialog.Builder(activity).setTitle("播放画质").setItems(arrayOf("自动","4 Mbps","8 Mbps","15 Mbps","25 Mbps","40 Mbps")) { _,index -> activity.bitrate(rates[index]) }.show() })
        actions.addView(button("弹幕") { danmakuMenu() }); actions.addView(button("设置") { player.dispatch("pause",JSONArray()); activity.showWebSettings() })
        scroll.addView(actions); controls.addView(scroll); addView(controls,LayoutParams(LayoutParams.MATCH_PARENT,LayoutParams.WRAP_CONTENT,Gravity.BOTTOM))
    }
    private fun dp(value: Int) = (value*resources.displayMetrics.density).toInt()
    private fun button(label: String,action: () -> Unit) = Button(activity).apply { text = label; textSize = 14f; setTextColor(Color.rgb(255,190,56)); setBackgroundColor(Color.TRANSPARENT); minWidth = dp(64); minHeight = dp(48); setOnClickListener { runCatching(action).onFailure { activity.notify(it.message ?: "操作失败") } } }
    fun setTitle(value: String) { title.text = value }
    private fun tracks(type: String) {
        if(type == "sub") {
            val streams = player.dispatch("getSubtitleStreams",JSONArray()) as JSONArray
            if(streams.length() > 0) {
                val labels = arrayOf("关闭字幕") + (0 until streams.length()).map { streams.getJSONObject(it).optString("title","字幕") }.toTypedArray()
                AlertDialog.Builder(activity).setTitle("字幕").setItems(labels) { _,index -> activity.subtitle(if(index == 0) -1 else streams.getJSONObject(index-1).getInt("index")) }.show()
                return
            }
        }
        val raw = player.tracks(); val tracks = (0 until raw.length()).map { raw.getJSONObject(it) }.filter { it.optString("type") == type }
        val labels = tracks.map { "${it.optString("title",if(type == "audio") "音轨" else "字幕")} · ${it.optString("lang","未标注语言")} #${it.optInt("id")}" }.toMutableList()
        if(type == "sub") labels.add(0,"关闭字幕")
        if(labels.isEmpty()) { activity.notify("没有可用音轨"); return }
        AlertDialog.Builder(activity).setTitle(if(type == "audio") "音轨" else "字幕").setItems(labels.toTypedArray()) { _,index ->
            val id = if(type == "sub" && index == 0) -1 else tracks[index-if(type == "sub") 1 else 0].getInt("id")
            player.dispatch(if(type == "audio") "setAudioStream" else "setSubtitleStream",JSONArray().put(id))
        }.show()
    }
    private fun subtitleOffset() {
        val info = player.dispatch("mpvDiagnostics",JSONArray()) as org.json.JSONObject
        val input = EditText(activity).apply { inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED; setText(info.optDouble("subtitleDelay").toString()) }
        AlertDialog.Builder(activity).setTitle("字幕偏移（秒，正值延后）").setView(input).setPositiveButton("保存") { _,_ ->
            val seconds = input.text.toString().toDoubleOrNull()
            if(seconds != null && seconds.isFinite() && seconds in -600.0..600.0) player.dispatch("setSubtitleDelay",JSONArray().put(seconds*1000)) else activity.notify("请输入 -600 到 600 秒")
        }.setNeutralButton("重置") { _,_ -> player.dispatch("setSubtitleDelay",JSONArray().put(0)) }.setNegativeButton("取消",null).show()
    }
    private fun danmakuMenu() {
        AlertDialog.Builder(activity).setTitle("弹幕").setItems(arrayOf("开启／关闭弹幕","搜索弹幕","来源、屏蔽与时间偏移","导入 XML / JSON / ASS","弹幕样式","添加视频网站来源")) { _,index -> when(index) {
            0 -> activity.toggleDanmaku(); 1 -> searchDialog(); 2 -> sourceDialog(); 3 -> activity.chooseDanmakuFile(); 4 -> { player.dispatch("pause",JSONArray()); activity.showWebSettings("danmaku") }
            5 -> { val url = EditText(activity).apply { hint = "HTTP(S) 视频页面网址"; inputType = android.text.InputType.TYPE_CLASS_TEXT or android.text.InputType.TYPE_TEXT_VARIATION_URI }; AlertDialog.Builder(activity).setTitle("添加弹幕来源").setView(url).setPositiveButton("加载") { _,_ -> network { repository.loadUrl(url.text.toString()) } }.setNegativeButton("取消",null).show() }
        } }.show()
    }
    private fun searchDialog() {
        val token = repository.currentToken()
        val input = EditText(activity).apply { hint = "作品名称"; setSingleLine() }
        AlertDialog.Builder(activity).setTitle("搜索弹幕").setView(input).setPositiveButton("搜索") { _,_ -> network {
            val result = repository.search(input.text.toString())
            activity.runOnUiThread { if(!repository.isCurrent(token)) return@runOnUiThread; selectArray("选择作品",result,"animeTitle") { index ->
                val anime = result.getJSONObject(index); val id = anime.get("bangumiId").toString(); repository.rememberMatch(id)
                network { val episodes = repository.episodes(id); activity.runOnUiThread { if(!repository.isCurrent(token)) return@runOnUiThread; selectArray("选择集数",episodes,"episodeTitle") { episode -> network { val selected = episodes.getJSONObject(episode); repository.load(selected.get("episodeId").toString(),selected.optString("episodeTitle"),token) } } } }
            } }
        } }.setNegativeButton("取消",null).show()
    }
    private fun selectArray(title: String,array: JSONArray,key: String,selected: (Int) -> Unit) {
        if(array.length() == 0) { activity.notify("没有搜索结果"); return }
        if(activity.isFinishing) return
        AlertDialog.Builder(activity).setTitle(title).setItems((0 until array.length()).map { array.getJSONObject(it).optString(key,"未命名") }.toTypedArray()) { _,index -> selected(index) }.show()
    }
    private fun sourceDialog() {
        val sources = repository.sources
        if(sources.isEmpty()) { activity.notify("尚未加载弹幕，请先搜索或导入"); return }
        AlertDialog.Builder(activity).setTitle("弹幕来源").setItems(sources.map { "${if(it.enabled) "显示" else "屏蔽"} · ${it.title} · 偏移 ${it.delay}s" }.toTypedArray()) { _,index ->
            val source = sources[index]; val input = EditText(activity).apply { inputType = android.text.InputType.TYPE_CLASS_NUMBER or android.text.InputType.TYPE_NUMBER_FLAG_DECIMAL or android.text.InputType.TYPE_NUMBER_FLAG_SIGNED; setText(source.delay.toString()) }
            AlertDialog.Builder(activity).setTitle("时间偏移（秒）").setView(input).setPositiveButton("保存") { _,_ -> runCatching { repository.sourceSetting(source.id,source.enabled,input.text.toString().toDouble()) }.onFailure { activity.notify("请输入 -3600 到 3600 秒") } }
                .setNeutralButton(if(source.enabled) "屏蔽此源" else "显示此源") { _,_ -> repository.sourceSetting(source.id,!source.enabled,source.delay) }.setNegativeButton("取消",null).show()
        }.show()
    }
    private fun network(action: () -> Unit) { thread { runCatching(action).onFailure { activity.runOnUiThread { activity.notify(it.message ?: "弹幕服务暂不可用") } } } }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); handler.post(update) }
    override fun onDetachedFromWindow() { handler.removeCallbacks(update); handler.removeCallbacks(hide); super.onDetachedFromWindow() }
    private fun format(ms: Long): String { val seconds = ms/1000; return "%d:%02d".format(seconds/60,seconds%60) }
}
