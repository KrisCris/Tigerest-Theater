package top.tigerest.theater

import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class DiagnosticsLogTest {
    @Test fun clockRollbackDoesNotExtendCaptureWindow() {
        var time = 1000000L
        val log = DiagnosticsLog { time }; log.setScope("clock-scope")
        log.record("info","future record")
        time = 0; log.record("info","expired record after rollback")
        time = 700000
        assertEquals(0,log.collect().length())
    }
    @Test fun redactsSensitiveRecordsBeforeExposure() {
        val records = listOf(
            """{"AccessToken":"SECRET\"AFTER"}""", """body={\"Password\":\"SECRET\"}""",
            "{\n\"password\":\n\"SECRET\nSECOND\"}", "aUtHoRiZaTiOn: bEaReR SECRET", "Authorization: Basic SECRET",
            "SET-cookie: session=SECRET", "https://person:SECRET@example.test/a", "api%255fkey%253DSECRET",
            "{\"UserId\":\"SECRET\"}", "signature=SECRET", "person.SECRET@example.test",
            "C:\\Users\\SECRET\\movie.mkv", "/data/user/SECRET/files", "\\\\server\\SECRET\\movie",
            """{"\u0041ccessToken":"SECRET"}""", "person.SECRET@private-domain", "a".repeat(60000) + "SECRET@private-domain",
            "https%253A%252F%252Fexample.test%252Fstream%253Fopaque%253DSECRET",
            """https:\/\/example.test\/stream?opaque=SECRET""", "path:C:\\Users\\SECRET\\movie.mkv"
        )
        for(record in records) {
            val clean = ReportLogSanitizer.sanitize(record)
            assertFalse(clean.contains("SECRET")); assertFalse(clean.contains("AFTER")); assertFalse(clean.contains("SECOND"))
            assertTrue(clean.isNotEmpty())
        }
    }
    @Test fun validUnicodeAndControlCharacters() {
        val clean = ReportLogSanitizer.sanitize("播放器失败 😀\n下一行\t线索\r\u0000\u0001\uD800")
        assertTrue(clean.contains("播放器失败 😀")); assertTrue(clean.contains('\n')); assertTrue(clean.contains('\t'))
        assertFalse(clean.contains('\u0000')); assertFalse(clean.contains('\u0001')); assertFalse(clean.contains('\uD800'))
    }
    @Test fun accountBoundaryTimeAndByteLimit() {
        var time = 0L
        val log = DiagnosticsLog { time }
        log.record("info", "no account")
        assertTrue(log.collect().length() == 0)
        log.setScope("private-old-scope")
        log.record("error", "OLD_ACCOUNT")
        time = 100
        log.setScope("private-current-scope")
        log.record("error", "current playback error")
        log.record("error", "AccessToken=SECRET")
        log.setScope("private-current-scope")
        val current = log.collect()
        assertTrue(current.getString("capturedAt").endsWith("Z")); Instant.parse(current.getString("capturedAt"))
        assertTrue(current.get("truncated") is Boolean)
        assertTrue(current.getString("logText").contains("current playback error"))
        assertFalse(current.getString("logText").contains("OLD_ACCOUNT")); assertFalse(current.getString("logText").contains("SECRET"))
        assertFalse(current.getString("logText").contains("private-current-scope"))
        time += 600001
        assertTrue(log.collect().length() == 0)
        repeat(500) { log.record("info", "中".repeat(2048)) }
        val tail = log.collect()
        assertTrue(tail.getBoolean("truncated")); assertTrue(tail.getString("logText").toByteArray(Charsets.UTF_8).size <= 1048576)
        log.setScope(""); assertTrue(log.collect().length() == 0)
    }
}
