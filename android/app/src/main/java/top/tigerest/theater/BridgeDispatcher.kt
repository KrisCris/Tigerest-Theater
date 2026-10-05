package top.tigerest.theater

import android.content.Intent
import android.net.Uri
import androidx.webkit.JavaScriptReplyProxy
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class BridgeDispatcher(private val activity: MainActivity, private val settings: SettingsStore, private val player: PlaybackController) {
    private val worker = Executors.newSingleThreadExecutor()
    private val network = Executors.newCachedThreadPool()
    private val http = OkHttpClient.Builder().connectTimeout(8,TimeUnit.SECONDS).readTimeout(12,TimeUnit.SECONDS).followRedirects(false).build()
    private var proxy: JavaScriptReplyProxy? = null
    @Volatile private var epoch = 0L
    private var connection = 0L
    fun pageStarted() { epoch++; proxy = null }
    fun emit(component: String, signal: String, args: JSONArray = JSONArray()) {
        val target = proxy ?: return
        val generation = epoch
        activity.runOnUiThread { if(generation == epoch && proxy === target) target.postMessage(JSONObject().put("component",component).put("signal",signal).put("args",args).toString()) }
    }
    fun request(text: String, reply: JavaScriptReplyProxy) {
        if(text.length > 1024*1024) return
        proxy = reply; val generation = epoch
        val request = runCatching { JSONObject(text) }.getOrNull() ?: return
        val executor = if(request.optString("component") == "danmaku" && request.optString("method") in setOf("search","episodes","load","loadUrl")) network else worker
        executor.execute {
            if(generation != epoch) return@execute
            val id = request.optLong("id"); if(id <= 0) return@execute
            val response = JSONObject().put("id",id)
            try { response.put("result",call(request.getString("component"),request.getString("method"),request.optJSONArray("args") ?: JSONArray()) ?: JSONObject.NULL) }
            catch(error: Exception) { response.put("error",if(error is IllegalArgumentException || error is IllegalStateException) error.message?.take(180) ?: "操作无效" else "客户端操作失败，请重试") }
            activity.runOnUiThread { if(generation == epoch) reply.postMessage(response.toString()) }
        }
    }
    private fun call(component: String, method: String, args: JSONArray): Any? = when(component) {
        "player" -> player.dispatch(method,args)
        "settings" -> when(method) {
            "setValue" -> settings.set(args.getString(0),args.getString(1),args.get(2))
            "resetToDefault" -> settings.reset(args.getString(0))
            "value" -> settings.get(args.getString(0),args.getString(1))
            else -> throw IllegalArgumentException("设置操作无效")
        }
        "system" -> when(method) {
            "hello" -> true
            "getUserAgent" -> "Tigerest Theater Android/${BuildConfig.VERSION_NAME}"
            "systemInformation", "debugInformation" -> activity.diagnostics()
            "isAddressOnLocalSubnet" -> java.net.NetworkInterface.getNetworkInterfaces().toList().any { item -> item.interfaceAddresses.any { it.address?.hostAddress?.startsWith("192.168.5.") == true } }
            "checkServerConnectivity" -> { val address = args.getString(0); val token = ++connection; val generation = epoch
                network.execute {
                    var success = false; var web = ""; var error = "无法连接 Emby 服务器，请检查网络和地址"
                    runCatching {
                        val base = ServerAddress.base(address)
                        http.newCall(Request.Builder().url(base+"System/Info/Public").build()).execute().use { response ->
                            require(response.isSuccessful); val info = JSONObject(response.body?.string() ?: "{}"); require(info.has("Id") || info.has("Version"))
                            web = base+"web/index.html"; success = true
                        }
                    }.onFailure { if(it is IllegalArgumentException) error = it.message ?: error }
                    activity.runOnUiThread { if(token == connection && generation == epoch) emit("system","serverConnectivityResult",JSONArray().put(address).put(success).put(web).put(error)) }
                }; true
            }
            "cancelServerConnectivity" -> { connection++; true }
            "openExternalUrl" -> { val uri = Uri.parse(args.getString(0)); require(uri.scheme in listOf("http","https")); activity.runOnUiThread { activity.openExternal(uri.toString()) }; true }
            "exit" -> { activity.runOnUiThread { activity.finish() }; true }
            "restart" -> { activity.runOnUiThread { activity.webHost.openSaved() }; true }
            else -> throw IllegalArgumentException("安卓不支持此系统操作")
        }
        "window" -> when(method) {
            "isFullScreen" -> activity.fullscreen
            "setFullScreen" -> { activity.runOnUiThread { activity.setFullscreen(args.getBoolean(0)) }; true }
            "requestPlaybackFullScreen" -> { activity.runOnUiThread { activity.setFullscreen(true) }; true }
            "beginPlaybackSession", "endPlaybackSession" -> { activity.runOnUiThread { if(method == "beginPlaybackSession") activity.beginPlaybackSession() else activity.endPlaybackSession() }; true }
            "setCursorVisibility" -> true // Android keeps a pointer visible when a pointer device is present.
            else -> throw IllegalArgumentException("窗口操作无效")
        }
        "danmaku" -> if(method == "importFile") { activity.runOnUiThread { activity.chooseDanmakuFile() }; true } else activity.danmaku.dispatch(method,args)
        else -> throw IllegalArgumentException("客户端组件无效")
    }
    fun close() { epoch++; proxy = null; worker.shutdownNow(); network.shutdownNow() }
}
