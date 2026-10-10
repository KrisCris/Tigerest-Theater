package top.tigerest.theater

import android.content.ContextWrapper
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files

class AndroidAppUpdateSourceTest {
    private val candidate = AppUpdateCandidate("2.5.0", "", "", 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.5.0/TigerestTheater-2.5.0-android.apk")
    private fun scenario(text: String, responses: List<MockResponse>, action: (AndroidAppUpdateSource, File, MockWebServer) -> Unit) {
        val server = MockWebServer()
        responses.forEach { server.enqueue(it) }; server.start()
        val source = AndroidAppUpdateSource(ContextWrapper(null))
        source.debugFixture("http://127.0.0.1:${server.port}")
        val file = Files.createTempFile("source-transfer", ".part").toFile().apply { writeText(text) }
        try { action(source, file, server) } finally { source.cancel(); server.shutdown(); file.delete() }
    }

    @Test fun savedPrefixSendsRangeAndIdentityEncoding() = scenario("a", listOf(
        MockResponse().setResponseCode(206).setHeader("Content-Range", "bytes 1-2/3").setBody("bc")
    )) { source, file, server ->
        source.download(candidate, file, { false }, {})
        val request = server.takeRequest()
        assertEquals("bytes=1-", request.getHeader("Range")); assertEquals("identity", request.getHeader("Accept-Encoding"))
        assertEquals("/download", request.path); assertEquals("abc", file.readText())
    }

    @Test fun rejectedRangeIsClearedBeforeFreshRequest() = scenario("a", listOf(
        MockResponse().setResponseCode(416), MockResponse().setResponseCode(200).setBody("abc")
    )) { source, file, server ->
        assertThrows(IOException::class.java) { source.download(candidate, file, { false }, {}) }
        assertEquals(0L, file.length())
        source.download(candidate, file, { false }, {})
        assertEquals("bytes=1-", server.takeRequest().getHeader("Range")); assertNull(server.takeRequest().getHeader("Range"))
        assertEquals("abc", file.readText())
    }

    @Test fun serverFailureIsRetryableAndPreservesPrefix() = scenario("a", listOf(
        MockResponse().setResponseCode(503).setBody("busy")
    )) { source, file, _ ->
        assertThrows(IOException::class.java) { source.download(candidate, file, { false }, {}) }
        assertEquals("a", file.readText())
    }

    @Test fun completePrefixAvoidsTheNetwork() = scenario("abc", listOf(
        MockResponse().setBody("abc")
    )) { source, file, server ->
        val progress = mutableListOf<Long>()
        source.download(candidate, file, { false }) { progress.add(it) }
        assertEquals(0, server.requestCount); assertEquals(listOf(3L), progress); assertEquals("abc", file.readText())
    }
}
