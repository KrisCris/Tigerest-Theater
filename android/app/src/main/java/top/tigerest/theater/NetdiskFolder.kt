package top.tigerest.theater

import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URI
import java.net.URLEncoder

/** One HTTP GET with the given cookies. Response cookies come back as name=value pairs. */
class NetdiskResponse(val code: Int, val body: String, val cookies: List<String> = emptyList())
fun interface NetdiskHttp { fun exchange(url: String, cookies: List<String>): NetdiskResponse }

/**
 * Finds the subfolder named after a release in a Baidu netdisk share and returns the mobile web page that
 * opens it. Only the anonymous, read-only share listing is used; downloading still happens in the netdisk
 * page or app after the user signs in there. Quark's mobile share page has no address for a subfolder, so
 * a Quark share opens at the shared folder. Any failure, including a missing folder, returns the share itself.
 */
class NetdiskFolder(private val http: NetdiskHttp, private val clock: () -> Long = System::nanoTime) {
    private class Entry(val name: String, val path: String, val folder: Boolean)

    fun resolve(share: String, version: String): String = runCatching { find(share, version) }.getOrNull() ?: share

    private fun find(share: String, version: String): String? {
        val uri = URI(share)
        val id = Regex("/s/([0-9A-Za-z_-]{6,64})").matchEntire(uri.rawPath.orEmpty())?.groupValues?.get(1)
        // A Baidu extraction code needs a verification round; the share page asks for it instead.
        if (uri.scheme != "https" || uri.host != "pan.baidu.com" || id == null || uri.rawQuery != null || version.isEmpty()) return null
        val deadline = clock() + 10_000_000_000L
        val exchange = { url: String, cookies: List<String> ->
            check(clock() < deadline) { "netdisk lookup timed out" }
            http.exchange(url, cookies).also { check(it.code == 200) { "HTTP ${it.code}" } }
        }
        // The listing endpoint answers only a client holding the share page's cookies.
        val cookies = exchange(share, emptyList()).cookies
        // The version folder sits at most one level below the shared folder.
        val pending = ArrayDeque(listOf("" to 0))
        var listings = 0
        while (pending.isNotEmpty() && listings++ < 8) {
            val (folder, depth) = pending.removeFirst()
            // Baidu's listing names the share by its short URL without the leading character.
            val place = if (folder.isEmpty()) arrayOf("root" to "1") else arrayOf("dir" to folder, "root" to "0")
            val listing = JSONObject(exchange("https://pan.baidu.com/share/list?" +
                query("shorturl" to id.substring(1), "page" to "1", "num" to "100", "web" to "1", *place), cookies).body)
            check(listing.optInt("errno", -1) == 0)
            for (entry in entries(listing.optJSONArray("list"))) {
                if (!entry.folder || !baiduPath.matches(entry.path)) continue
                if (entry.name == version || entry.name == "v$version") return baiduFolderPage(id, entry.path)
                if (depth < 1) pending.add(entry.path to depth + 1)
            }
        }
        return null
    }

    private fun entries(items: JSONArray?) = (0 until (items?.length() ?: 0)).mapNotNull { items?.optJSONObject(it) }
        .map { Entry(it.optString("server_filename"), it.optString("path"), it.optString("isdir") == "1") }

    companion object {
        private val baiduPath = Regex("/.{1,1023}")
        private fun encode(value: String) = URLEncoder.encode(value, "UTF-8").replace("+", "%20")
        private fun query(vararg items: Pair<String, String>) = items.joinToString("&") { "${it.first}=${encode(it.second)}" }
        /** Phones get Baidu's mobile share page, which drops a desktop page's folder path when it redirects. */
        fun baiduFolderPage(id: String, path: String) = "https://pan.baidu.com/wap/link?surl=$id#/home/%2F/${encode(path)}"
    }
}

/** Reads at most 1 MiB per response and does not follow redirects. */
class OkHttpNetdisk(private val client: OkHttpClient, private val userAgent: String) : NetdiskHttp {
    override fun exchange(url: String, cookies: List<String>): NetdiskResponse {
        val request = Request.Builder().url(url).header("User-Agent", userAgent)
        if (cookies.isNotEmpty()) request.header("Cookie", cookies.joinToString("; "))
        client.newCall(request.build()).execute().use { response ->
            val bytes = response.body?.byteStream()?.readNBytes(MAXIMUM_BYTES + 1) ?: ByteArray(0)
            if (bytes.size > MAXIMUM_BYTES) throw IOException("netdisk response too large")
            return NetdiskResponse(response.code, bytes.toString(Charsets.UTF_8),
                response.headers("Set-Cookie").map { it.substringBefore(';').trim() }.filter { '=' in it })
        }
    }
    private companion object { const val MAXIMUM_BYTES = 1024 * 1024 }
}
