package top.tigerest.theater

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.net.URLEncoder

/** One HTTP exchange: a GET, or a JSON POST when [json] is given. Response cookies come back as name=value pairs. */
class NetdiskResponse(val code: Int, val body: String, val cookies: List<String> = emptyList())
fun interface NetdiskHttp { fun exchange(url: String, json: String?, cookies: List<String>): NetdiskResponse }

/**
 * Finds the subfolder named after a release in a Quark or Baidu netdisk share and returns the web page that
 * opens it. Only the anonymous, read-only share listing is used; downloading still happens in the netdisk
 * page or app after the user signs in there. Any failure, including a missing folder, returns the share itself.
 */
class NetdiskFolder(private val http: NetdiskHttp, private val clock: () -> Long = System::nanoTime) {
    private class Entry(val name: String, val id: String, val folder: Boolean)

    fun resolve(share: String, version: String): String = runCatching { find(share, version) }.getOrNull() ?: share

    private fun find(share: String, version: String): String? {
        val uri = URI(share)
        val id = Regex("/s/([0-9A-Za-z_-]{6,64})").matchEntire(uri.rawPath.orEmpty())?.groupValues?.get(1)
        if (uri.scheme != "https" || id == null || version.isEmpty()) return null
        val code = uri.rawQuery?.split('&')?.firstOrNull { it.startsWith("pwd=") }?.substring(4).orEmpty()
        val deadline = clock() + 10_000_000_000L
        val exchange = { url: String, json: String?, cookies: List<String> ->
            check(clock() < deadline) { "netdisk lookup timed out" }
            http.exchange(url, json, cookies).also { check(it.code == 200) { "HTTP ${it.code}" } }
        }
        return when (uri.host) {
            "pan.quark.cn" -> {
                val token = exchange("$QUARK_API/token?pr=ucpro&fr=pc", JSONObject().put("pwd_id", id).put("passcode", code).toString(), emptyList())
                val stoken = JSONObject(token.body).optJSONObject("data")?.optString("stoken").orEmpty()
                check(stoken.isNotEmpty())
                search(version, "0") { folder ->
                    val listing = exchange("$QUARK_API/detail?" + query("pr" to "ucpro", "fr" to "pc", "pwd_id" to id, "stoken" to stoken,
                        "pdir_fid" to folder, "force" to "0", "_page" to "1", "_size" to "100"), null, emptyList())
                    entries(JSONObject(listing.body).optJSONObject("data")?.optJSONArray("list")) {
                        Entry(it.optString("file_name"), it.optString("fid"), it.optBoolean("dir"))
                    }.filter { quarkId.matches(it.id) }
                }?.let { quarkFolderPage(share, it) }
            }
            // A Baidu extraction code needs a verification round; the share page asks for it instead.
            "pan.baidu.com" -> if (code.isNotEmpty()) null else {
                // The listing endpoint answers only a client holding the share page's cookies.
                val cookies = exchange(share, null, emptyList()).cookies
                search(version, "") { folder ->
                    // Baidu's listing names the share by its short URL without the leading character.
                    val place = if (folder.isEmpty()) arrayOf("root" to "1") else arrayOf("dir" to folder, "root" to "0")
                    val listing = JSONObject(exchange("https://pan.baidu.com/share/list?" +
                        query("shorturl" to id.substring(1), "page" to "1", "num" to "100", "web" to "1", *place), null, cookies).body)
                    check(listing.optInt("errno", -1) == 0)
                    entries(listing.optJSONArray("list")) { Entry(it.optString("server_filename"), it.optString("path"), it.optString("isdir") == "1") }
                        .filter { baiduPath.matches(it.id) }
                }?.let { baiduFolderPage(share, it) }
            }
            else -> null
        }
    }

    /** The version folder sits at most one level below the shared folder. */
    private fun search(version: String, root: String, list: (String) -> List<Entry>): String? {
        val pending = ArrayDeque(listOf(root to 0))
        var listings = 0
        while (pending.isNotEmpty() && listings++ < 8) {
            val (folder, depth) = pending.removeFirst()
            for (entry in list(folder)) {
                if (!entry.folder) continue
                if (entry.name == version || entry.name == "v$version") return entry.id
                if (depth < 1) pending.add(entry.id to depth + 1)
            }
        }
        return null
    }

    private fun entries(items: JSONArray?, read: (JSONObject) -> Entry) =
        (0 until (items?.length() ?: 0)).mapNotNull { items?.optJSONObject(it) }.map(read)

    companion object {
        private const val QUARK_API = "https://drive-h.quark.cn/1/clouddrive/share/sharepage"
        private val quarkId = Regex("[0-9A-Za-z]{1,64}")
        private val baiduPath = Regex("/.{1,1023}")
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        private fun query(vararg items: Pair<String, String>) = items.joinToString("&") { "${it.first}=${encode(it.second)}" }
        fun quarkFolderPage(share: String, fid: String) = "$share#/list/share/$fid"
        fun baiduFolderPage(share: String, path: String) = "$share#list/path=${encode(path)}"
    }
}

/** Reads at most 1 MiB per response and does not follow redirects. */
class OkHttpNetdisk(private val client: OkHttpClient, private val userAgent: String) : NetdiskHttp {
    override fun exchange(url: String, json: String?, cookies: List<String>): NetdiskResponse {
        val request = Request.Builder().url(url).header("User-Agent", userAgent)
        if (cookies.isNotEmpty()) request.header("Cookie", cookies.joinToString("; "))
        if (json != null) request.post(json.toRequestBody("application/json".toMediaType()))
        client.newCall(request.build()).execute().use { response ->
            val bytes = response.body?.byteStream()?.readNBytes(MAXIMUM_BYTES + 1) ?: ByteArray(0)
            if (bytes.size > MAXIMUM_BYTES) throw IOException("netdisk response too large")
            return NetdiskResponse(response.code, bytes.toString(Charsets.UTF_8),
                response.headers("Set-Cookie").map { it.substringBefore(';').trim() }.filter { '=' in it })
        }
    }
    private companion object { const val MAXIMUM_BYTES = 1024 * 1024 }
}
