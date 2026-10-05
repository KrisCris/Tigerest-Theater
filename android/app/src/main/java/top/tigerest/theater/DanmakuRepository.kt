package top.tigerest.theater

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.io.File
import java.security.MessageDigest

data class DanmakuSource(val id: String, val title: String, val comments: List<DanmakuComment>, var enabled: Boolean = true, var delay: Double = 0.0, val policyId: String = id)
class DanmakuRepository(private val context: Context,private val settings: SettingsStore) {
    private val client = OkHttpClient.Builder().connectTimeout(8,TimeUnit.SECONDS).readTimeout(20,TimeUnit.SECONDS).build()
    private val executor = Executors.newSingleThreadExecutor()
    private val prefs = context.getSharedPreferences("danmaku-sources",Context.MODE_PRIVATE)
    @Volatile private var generation = 0L
    @Volatile var sources: List<DanmakuSource> = emptyList(); private set
    var changed: () -> Unit = {}
    var status: (String) -> Unit = {}
    private var group = ""
    private var itemKey = ""
    private val cache = File(context.filesDir,"danmaku-history").apply { mkdirs() }
    private var item = JSONObject()
    private fun base(): String = settings.string("danmaku","apiServer").takeIf { it.isNotBlank() }?.let { ServerAddress.base(it).trimEnd('/') } ?: if(settings.string("main","userWebClient").contains("192.168.5.150")) "http://192.168.5.150:18443" else "http://nas.tigerest.top:18443"
    private fun fetch(path: String): JSONObject {
        val url = base()+path
        client.newCall(Request.Builder().url(url).header("Accept","application/json").header("User-Agent","TigerestTheater Android").build()).execute().use { response ->
            require(response.isSuccessful) { "弹幕服务暂不可用（${response.code}）" }
            val body = response.body ?: throw IllegalStateException("弹幕响应为空")
            require(body.contentLength() < 32*1024*1024) { "弹幕文件过大" }
            val bytes = body.byteStream().use { it.readNBytes(16*1024*1024+1) }; require(bytes.size <= 16*1024*1024) { "弹幕文件过大" }; val text = bytes.toString(Charsets.UTF_8)
            return JSONObject(text)
        }
    }
    @Synchronized fun autoMatch(metadata: JSONObject) {
        val token = ++generation; item = metadata
        group = metadata.optString("SeriesName",metadata.optString("Name"))+":"+metadata.optInt("ParentIndexNumber",-1)
        itemKey = metadata.optString("Id").ifBlank { metadata.optString("Name")+":"+metadata.optInt("IndexNumber",-1) }
        val historyKey = itemKey
        sources = emptyList(); changed()
        if(!settings.bool("mpv","enableDanmaku")) return
        executor.execute {
            try {
                val history = runCatching { JSONArray(prefs.getString("history:$historyKey","[]")) }.getOrDefault(JSONArray())
                for(index in 0 until minOf(history.length(),12)) {
                    if(token != generation) return@execute
                    val record = history.getJSONObject(index)
                    val file = File(cache,cacheName(historyKey,record.getString("id")))
                    if(file.exists() && file.length() <= 16*1024*1024) runCatching { add(record.getString("id"),record.getString("title"),DanmakuParser.parse(file.readText()),token,false,record.optString("policy",record.getString("id"))) }
                }
                if(token != generation || sources.isNotEmpty()) return@execute
                val title = metadata.optString("SeriesName",metadata.optString("Name"))
                if(title.isBlank()) return@execute
                val animes = search(title)
                if(token != generation) return@execute
                val savedBangumi = prefs.getString("match:$group",null)
                val selected = (0 until animes.length()).map { animes.getJSONObject(it) }.let { results ->
                    results.find { it.optString("bangumiId") == savedBangumi }
                        ?: DanmakuMatch.select(results,title,metadata.optInt("ParentIndexNumber",-1))
                }
                if(selected == null) { status("弹幕未自动匹配，请手动搜索作品"); return@execute }
                val episodeNumber = metadata.optInt("IndexNumber",-1)
                val episodes = episodes(selected.get("bangumiId").toString())
                val episode = (0 until episodes.length()).map { episodes.getJSONObject(it) }.let { records -> records.find { it.optString("episodeNumber").toDoubleOrNull() == episodeNumber.toDouble() } ?: records.singleOrNull() }
                if(episode == null) { status("请手动选择弹幕集数"); return@execute }
                if(token == generation) load(episode.get("episodeId").toString(),episode.optString("episodeTitle",title),token)
            } catch(_: Exception) { if(token == generation) status("弹幕暂不可用，可以稍后手动搜索") }
        }
    }
    fun search(keyword: String): JSONArray { require(keyword.isNotBlank() && keyword.length <= 200); return fetch("/api/v2/search/anime?keyword="+URLEncoder.encode(keyword,"UTF-8")).optJSONArray("animes") ?: JSONArray() }
    fun episodes(id: String): JSONArray { require(id.matches(Regex("[0-9]+"))); val bangumi = fetch("/api/v2/bangumi/$id").optJSONObject("bangumi") ?: JSONObject(); return bangumi.optJSONArray("episodes") ?: JSONArray() }
    private fun cacheName(item: String,id: String) = MessageDigest.getInstance("SHA-256").digest((item+":"+id).toByteArray()).joinToString("") { "%02x".format(it) }+".json"
    @Synchronized private fun add(id: String,title: String,comments: List<DanmakuComment>,token: Long,remember: Boolean = true,policyId: String = id) {
        if(token != generation) return
        require(sources.size < 12 || sources.any { it.id == id }) { "最多添加 12 个弹幕来源" }
        val source = DanmakuSource(id,title,comments,prefs.getBoolean("enabled:$group:$policyId",true),prefs.getString("delay:$group:$policyId","0")?.toDoubleOrNull() ?: 0.0,policyId)
        sources = sources.filter { it.id != id }+source
        if(remember) {
            val json = JSONArray(); comments.forEach { json.put(JSONObject().put("p","${it.time},${it.mode},${it.color}").put("m",it.text)) }
            val text = JSONObject().put("comments",json).toString()
            if(text.toByteArray().size <= 16*1024*1024) File(cache,cacheName(itemKey,id)).writeText(text)
            val history = JSONArray(); sources.forEach { history.put(JSONObject().put("id",it.id).put("title",it.title).put("policy",it.policyId)) }
            prefs.edit().putString("history:$itemKey",history.toString()).apply()
            // Limit local history storage; preference entries without files are harmless.
            val files = cache.listFiles()?.sortedBy { it.lastModified() } ?: emptyList(); var total = files.sumOf { it.length() }
            for(file in files) { if(total <= 128L*1024*1024) break; total -= file.length(); file.delete() }
        }
        changed(); status("${title} · 已加载 ${comments.size} 条弹幕")
    }
    fun load(id: String,title: String = "弹幕",token: Long = generation): Int {
        require(id.matches(Regex("[0-9]+")))
        val json = fetch("/api/v2/comment/$id?withRelated=true&chConvert=0")
        val comments = DanmakuParser.parse(json.toString()); add(id,title,comments,token,policyId="dandanplay:"+base()); return comments.size
    }
    fun importText(id: String,title: String,text: String,token: Long = generation) { add(id,title,DanmakuParser.parse(text),token) }
    fun sourceSnapshot(): JSONArray = JSONArray().also { result -> sources.forEach { result.put(JSONObject().put("id",it.id).put("title",it.title).put("enabled",it.enabled).put("delay",it.delay).put("count",it.comments.size)) } }
    @Synchronized fun sourceSetting(id: String,enabled: Boolean,delay: Double) { require(delay.isFinite() && delay in -3600.0..3600.0); val source = sources.find { it.id == id } ?: throw IllegalArgumentException("弹幕来源不存在"); source.enabled = enabled; source.delay = delay; prefs.edit().putBoolean("enabled:$group:${source.policyId}",enabled).putString("delay:$group:${source.policyId}",delay.toString()).apply(); changed() }
    fun rememberMatch(bangumi: String) { prefs.edit().putString("match:$group",bangumi).apply() }
    fun currentToken() = generation
    fun isCurrent(token: Long) = generation == token
    fun dispatch(method: String,args: JSONArray): Any? = when(method) {
        "search" -> search(args.getString(0))
        "episodes" -> episodes(args.get(0).toString())
        "match" -> { autoMatch(args.getJSONObject(0)); true }
        "load" -> load(args.get(0).toString(),args.optString(1,"弹幕"))
        "sources" -> sourceSnapshot()
        "setSource" -> { sourceSetting(args.getString(0),args.getBoolean(1),args.getDouble(2)); true }
        "setEnabled" -> settings.set("mpv","enableDanmaku",args.getBoolean(0))
        "loadUrl" -> loadUrl(args.getString(0))
        else -> throw IllegalArgumentException("弹幕操作无效")
    }
    fun loadUrl(url: String): Int {
        val uri = java.net.URI(url); require(uri.scheme in listOf("http","https") && uri.host != null && uri.userInfo == null && url.length < 4096) { "弹幕来源网址无效" }
        val token = generation; val comments = DanmakuParser.parse(fetch("/api/v2/extcomment?url="+URLEncoder.encode(url,"UTF-8")).toString())
        add(url,uri.host,comments,token); return comments.size
    }
    @Synchronized fun clear() { generation++; sources = emptyList(); changed() }
    fun close() { clear(); executor.shutdownNow(); client.dispatcher.cancelAll() }
}
