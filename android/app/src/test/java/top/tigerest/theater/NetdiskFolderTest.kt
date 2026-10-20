package top.tigerest.theater

import org.junit.Assert.assertEquals
import org.junit.Test

class NetdiskFolderTest {
    private class Exchange(val url: String, val json: String?, val cookies: List<String>)
    private class Fixture(vararg responses: NetdiskResponse) : NetdiskHttp {
        val queue = ArrayDeque(responses.toList())
        val seen = mutableListOf<Exchange>()
        override fun exchange(url: String, json: String?, cookies: List<String>): NetdiskResponse {
            seen += Exchange(url, json, cookies)
            return queue.removeFirstOrNull() ?: NetdiskResponse(503, "")
        }
    }
    private val quark = AppUpdatePolicy.DEFAULT_QUARK_SHARE
    private val baidu = AppUpdatePolicy.DEFAULT_BAIDU_SHARE

    @Test fun opensTheQuarkVersionFolder() {
        val http = Fixture(NetdiskResponse(200, """{"data":{"stoken":"a+b/c="}}"""),
            NetdiskResponse(200, """{"data":{"list":[{"fid":"f1","file_name":"notes.txt","dir":false},{"fid":"root1","file_name":"Tigerest-Theater","dir":true}]}}"""),
            NetdiskResponse(200, """{"data":{"list":[{"fid":"f254","file_name":"2.5.4","dir":true},{"fid":"f250","file_name":"2.5.0","dir":true}]}}"""))
        assertEquals("https://pan.quark.cn/s/88e6f7a795b4#/list/share/f250", NetdiskFolder(http).resolve(quark, "2.5.0"))
        assertEquals("https://drive-h.quark.cn/1/clouddrive/share/sharepage/token?pr=ucpro&fr=pc", http.seen[0].url)
        val token = org.json.JSONObject(http.seen[0].json!!)
        assertEquals("88e6f7a795b4", token.getString("pwd_id")); assertEquals("", token.getString("passcode"))
        assertEquals(true, "stoken=a%2Bb%2Fc%3D&pdir_fid=0&" in http.seen[1].url)
        assertEquals(true, "&pdir_fid=root1&" in http.seen[2].url)
        assertEquals(3, http.seen.size)
    }

    @Test fun opensTheBaiduVersionFolderWithTheSharePageCookies() {
        val http = Fixture(NetdiskResponse(200, "<html></html>", listOf("BAIDUID=abc123")),
            NetdiskResponse(200, """{"errno":0,"list":[{"isdir":1,"server_filename":"Tigerest-Theater","path":"/software/Tigerest-Theater"}]}"""),
            NetdiskResponse(200, """{"errno":0,"list":[{"isdir":"1","server_filename":"2.5.0","path":"/software/Tigerest-Theater/2.5.0"}]}"""))
        assertEquals("https://pan.baidu.com/s/58azzOU4piiB3miyZqA1dig#list/path=%2Fsoftware%2FTigerest-Theater%2F2.5.0", NetdiskFolder(http).resolve(baidu, "2.5.0"))
        assertEquals(baidu, http.seen[0].url)
        assertEquals("https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&root=1", http.seen[1].url)
        assertEquals("https://pan.baidu.com/share/list?shorturl=8azzOU4piiB3miyZqA1dig&page=1&num=100&web=1&dir=%2Fsoftware%2FTigerest-Theater&root=0", http.seen[2].url)
        assertEquals(listOf("BAIDUID=abc123"), http.seen[2].cookies)
    }

    @Test fun fallsBackToTheShare() {
        // Missing folder, unreachable service, refused listing, extraction code, foreign host and a timeout.
        val missing = Fixture(NetdiskResponse(200, """{"data":{"stoken":"t"}}"""), NetdiskResponse(200, """{"data":{"list":[{"fid":"f3","file_name":"3.0.0","dir":true}]}}"""), NetdiskResponse(200, "{}"))
        assertEquals(quark, NetdiskFolder(missing).resolve(quark, "2.5.0"))
        assertEquals(3, missing.seen.size)
        assertEquals(quark, NetdiskFolder(Fixture()).resolve(quark, "2.5.0"))
        val refused = Fixture(NetdiskResponse(200, ""), NetdiskResponse(200, """{"errno":9019,"errmsg":"need verify"}"""))
        assertEquals(baidu, NetdiskFolder(refused).resolve(baidu, "2.5.0"))
        val coded = Fixture()
        assertEquals("$baidu?pwd=ab12", NetdiskFolder(coded).resolve("$baidu?pwd=ab12", "2.5.0"))
        assertEquals(0, coded.seen.size)
        assertEquals("https://example.com/s/abcdefg", NetdiskFolder(Fixture()).resolve("https://example.com/s/abcdefg", "2.5.0"))
        var now = 0L
        val slow = NetdiskHttp { _, _, _ -> now += 11_000_000_000L; NetdiskResponse(200, """{"data":{"stoken":"t"}}""") }
        assertEquals(quark, NetdiskFolder(slow) { now }.resolve(quark, "2.5.0"))
    }
}
