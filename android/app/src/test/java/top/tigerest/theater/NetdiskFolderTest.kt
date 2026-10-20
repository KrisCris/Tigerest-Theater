package top.tigerest.theater

import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

class NetdiskFolderTest {
    private class Fixture(vararg responses: NetdiskResponse) : NetdiskHttp {
        val queue = ArrayDeque(responses.toList())
        val seen = mutableListOf<Pair<String, List<String>>>()
        override fun exchange(url: String, cookies: List<String>): NetdiskResponse {
            seen += url to cookies
            return queue.removeFirstOrNull() ?: NetdiskResponse(503, "")
        }
    }
    private val quark = AppUpdatePolicy.DEFAULT_QUARK_SHARE
    private val baidu = AppUpdatePolicy.DEFAULT_BAIDU_SHARE

    @Test fun opensTheBaiduVersionFolderOnTheMobilePage() {
        val http = Fixture(NetdiskResponse(200, "<html></html>", listOf("BAIDUID=abc123")),
            NetdiskResponse(200, """{"errno":0,"list":[{"isdir":0,"server_filename":"notes.txt","path":"/notes.txt"},{"isdir":1,"server_filename":"Tigerest-Theater","path":"/software/Tigerest-Theater"}]}"""),
            NetdiskResponse(200, """{"errno":0,"list":[{"isdir":"1","server_filename":"2.5.4","path":"/software/Tigerest-Theater/2.5.4"},{"isdir":"1","server_filename":"2.5.0","path":"/software/Tigerest-Theater/2.5.0"}]}"""))
        assertEquals("https://pan.baidu.com/wap/link?surl=58azzOU4piiB3miyZqA1dig#/home/%2F/%2Fsoftware%2FTigerest-Theater%2F2.5.0",
            NetdiskFolder(http).resolve(baidu, "2.5.0"))
        assertEquals(baidu, http.seen[0].first)
        assertEquals("https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&root=1", http.seen[1].first)
        assertEquals("https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&dir=%2Fsoftware%2FTigerest-Theater&root=0", http.seen[2].first)
        assertEquals(listOf("BAIDUID=abc123"), http.seen[2].second)
        assertEquals(3, http.seen.size)
    }

    @Test fun fallsBackToTheShare() {
        // Quark (no mobile folder page), missing folder, unreachable service, refused listing, extraction code and a timeout.
        val quarkHttp = Fixture()
        assertEquals(quark, NetdiskFolder(quarkHttp).resolve(quark, "2.5.0"))
        assertEquals(0, quarkHttp.seen.size)
        val missing = Fixture(NetdiskResponse(200, ""), NetdiskResponse(200, """{"errno":0,"list":[{"isdir":1,"server_filename":"3.0.0","path":"/3.0.0"}]}"""),
            NetdiskResponse(200, """{"errno":0,"list":[]}"""))
        assertEquals(baidu, NetdiskFolder(missing).resolve(baidu, "2.5.0"))
        assertEquals(3, missing.seen.size)
        assertEquals(baidu, NetdiskFolder(Fixture()).resolve(baidu, "2.5.0"))
        val refused = Fixture(NetdiskResponse(200, ""), NetdiskResponse(200, """{"errno":9019,"errmsg":"need verify"}"""))
        assertEquals(baidu, NetdiskFolder(refused).resolve(baidu, "2.5.0"))
        val coded = Fixture()
        assertEquals("$baidu?pwd=ab12", NetdiskFolder(coded).resolve("$baidu?pwd=ab12", "2.5.0"))
        assertEquals(0, coded.seen.size)
        var now = 0L
        val slow = NetdiskHttp { _, _ -> now += 11_000_000_000L; NetdiskResponse(200, "") }
        assertEquals(baidu, NetdiskFolder(slow) { now }.resolve(baidu, "2.5.0"))
    }

    /** Reads the production share anonymously; run with TIGEREST_LIVE_NETDISK=<released version>. */
    @Test fun liveShareResolvesTheVersionFolder() {
        val version = System.getenv("TIGEREST_LIVE_NETDISK").orEmpty()
        assumeTrue(version.isNotEmpty())
        val page = NetdiskFolder(OkHttpNetdisk(OkHttpClient(), "Tigerest-Theater-Android/test")).resolve(baidu, version)
        println("live Baidu folder page: $page")
        assertTrue(page, page.endsWith("%2F$version"))
    }
}
