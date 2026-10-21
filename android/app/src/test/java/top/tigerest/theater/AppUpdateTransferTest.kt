package top.tigerest.theater

import okhttp3.MediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.io.IOException
import java.io.InterruptedIOException
import java.nio.file.Files

class AppUpdateTransferTest {
    private val candidate = AppUpdateCandidate("2.5.0", "", "", 3, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "")
    private fun response(code: Int, body: ResponseBody, contentRange: String? = null) = Response.Builder()
        .request(Request.Builder().url("https://release-assets.githubusercontent.com/asset").build())
        .protocol(Protocol.HTTP_1_1).code(code).message("fixture")
        .apply { if (contentRange != null) header("Content-Range", contentRange) }.body(body).build()
    private fun unknownLength(text: String, interrupted: Boolean = false) = object : ResponseBody() {
        private val input = object : ForwardingSource(Buffer().writeUtf8(text)) {
            override fun read(sink: Buffer, byteCount: Long): Long {
                val count = super.read(sink, byteCount)
                if (count == -1L && interrupted) throw IOException("socket closed")
                return count
            }
        }.buffer()
        override fun contentType(): MediaType? = null
        override fun contentLength() = -1L
        override fun source(): BufferedSource = input
    }
    private fun scenario(text: String, action: (File) -> Unit) {
        val file = Files.createTempFile("update-transfer", ".part").toFile().apply { writeText(text) }
        try { action(file) } finally { file.delete() }
    }
    private fun write(destination: File, response: Response, progress: MutableList<Long> = mutableListOf()) = response.use {
        writePackage(it, candidate, destination, resumeOffset(destination, candidate), { false }) { bytes -> progress.add(bytes) }
    }

    @Test fun completePrefixIsRecognizedForVerification() = scenario("abc") { assertEquals(3L, resumeOffset(it, candidate)) }
    @Test fun oversizedPrefixRestarts() = scenario("abcd") { assertEquals(0L, resumeOffset(it, candidate)) }
    @Test fun matchingPartialResponseAppends() = scenario("a") { destination ->
        val progress = mutableListOf<Long>()
        write(destination, response(206, "bc".toResponseBody(), "bytes 1-2/3"), progress)
        assertEquals("abc", destination.readText()); assertEquals(1L, progress.first()); assertEquals(3L, progress.last())
    }
    @Test fun fullResponseReplacesPrefix() = scenario("x") { destination ->
        val progress = mutableListOf<Long>()
        write(destination, response(200, "abc".toResponseBody()), progress)
        assertEquals("abc", destination.readText()); assertEquals(0L, progress.first())
    }
    @Test fun misalignedIncompleteMissingOrRejectedRangeClearsPrefix() {
        for (range in listOf("bytes 0-1/3", "bytes 1-1/3", "bytes 1-2/4", "bytes 1-2/*", null)) {
            scenario("a") { file ->
                assertThrows(IOException::class.java) { write(file, response(206, "bc".toResponseBody(), range)) }
                assertEquals(0L, file.length())
            }
        }
        scenario("a") { file -> assertThrows(IOException::class.java) { write(file, response(416, "".toResponseBody())) }; assertEquals(0L, file.length()) }
    }
    @Test fun unsolicitedPartialResponseIsRejected() = scenario("") { file ->
        assertThrows(IOException::class.java) { write(file, response(206, "abc".toResponseBody(), "bytes 0-2/3")) }
        assertEquals(0L, file.length())
    }
    @Test fun earlyEndKeepsAndReportsResumablePrefix() = scenario("") { destination ->
        val progress = mutableListOf<Long>()
        assertThrows(IOException::class.java) { write(destination, response(200, unknownLength("ab")), progress) }
        assertEquals("ab", destination.readText()); assertEquals(2L, progress.last())
    }
    @Test fun readFailureKeepsAndReportsResumablePrefix() = scenario("a") { destination ->
        val progress = mutableListOf<Long>()
        assertThrows(IOException::class.java) { write(destination, response(206, unknownLength("b", true), "bytes 1-2/3"), progress) }
        assertEquals("ab", destination.readText()); assertEquals(2L, progress.last())
    }
    @Test fun advertisedWrongLengthIsNotRetried() = scenario("a") { destination ->
        assertThrows(IllegalArgumentException::class.java) { write(destination, response(206, "bcd".toResponseBody(), "bytes 1-2/3")) }
        assertEquals("a", destination.readText())
    }
    @Test fun oversizedUnknownLengthResponseDoesNotWriteUntrustedBytes() = scenario("a") { destination ->
        assertThrows(IllegalArgumentException::class.java) { write(destination, response(206, unknownLength("bcd"), "bytes 1-2/3")) }
        assertEquals("a", destination.readText())
    }
    @Test fun cancellationAfterReadDoesNotWriteAnotherChunk() = scenario("a") { destination ->
        var stop = false
        val body = object : ResponseBody() {
            private val input = object : ForwardingSource(Buffer().writeUtf8("bc")) {
                override fun read(sink: Buffer, byteCount: Long): Long = super.read(sink, byteCount).also { stop = true }
            }.buffer()
            override fun contentType(): MediaType? = null
            override fun contentLength() = 2L
            override fun source(): BufferedSource = input
        }
        response(206, body, "bytes 1-2/3").use { reply ->
            assertThrows(InterruptedIOException::class.java) { writePackage(reply, candidate, destination, 1, { stop }, {}) }
        }
        assertEquals("a", destination.readText())
    }
    @Test fun nonPackageSuccessResponseIsRejected() = scenario("a") { destination ->
        assertThrows(IllegalStateException::class.java) { write(destination, response(204, "".toResponseBody())) }
        assertEquals("a", destination.readText())
    }

    /** Downloads the latest APK through the accelerators and checks GitHub's digest; run with TIGEREST_LIVE_PROXY=1. */
    @Test fun liveProxyDownloadsTheReleasedApk() {
        assumeTrue(System.getenv("TIGEREST_LIVE_PROXY").orEmpty().isNotEmpty())
        val http = okhttp3.OkHttpClient.Builder().followRedirects(false).readTimeout(45, java.util.concurrent.TimeUnit.SECONDS).build()
        val releases = http.newCall(Request.Builder().url("https://api.github.com/repos/Tigerest/Tigerest-Theater/releases?per_page=30").build())
            .execute().use { org.json.JSONArray(it.body!!.string()) }
        val latest = AppUpdatePolicy.select(releases, "0.0.1")!!
        val file = Files.createTempFile("live-proxy", ".apk").toFile()
        try {
            val sources = DownloadSources(latest.sha256, AppUpdatePolicy.downloadSources(latest.downloadUrl))
            val started = System.nanoTime()
            sources.run({ false }, { resumeOffset(file, latest) }) { url ->
                http.newCall(Request.Builder().url(url).header("Accept-Encoding", "identity").build()).execute().use { response ->
                    check(response.code == 200) { "HTTP ${response.code}" }
                    writePackage(response, latest, file, 0, { false }) {}
                }
            }
            AppUpdatePolicy.verifyFile(file, latest)
            println("live proxy: ${latest.version} ${latest.size} bytes in ${(System.nanoTime() - started) / 1_000_000} ms via ${sources.current}")
            assertEquals(0, sources.index)
        } finally { file.delete() }
    }

    @Test fun proxiesGiveWayToTheNextSourceUnlessTheyWereProgressing() {
        val release = "https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.5.0/a.apk"
        val urls = AppUpdatePolicy.downloadSources(release)
        assertEquals(listOf("https://gh-proxy.com/$release", "https://ghproxy.net/$release", release), urls)
        var retained = 0L
        val tried = mutableListOf<String>()
        // An unavailable proxy and a misbehaving one are skipped within one attempt; the release URL delivers.
        val sources = DownloadSources("sha", urls)
        assertEquals("done", sources.run({ false }, { retained }) { url ->
            tried += url
            when (url) { urls[0] -> throw IOException("refused"); urls[1] -> { retained = 1; throw IllegalArgumentException("oversized") }; else -> "done" }
        })
        assertEquals(urls, tried)
        // The release URL's own failure reaches the engine, whose next retry starts from the first proxy again.
        tried.clear(); retained = 0
        val failing = DownloadSources("sha", urls)
        assertThrows(IOException::class.java) { failing.run({ false }, { retained }) { url -> tried += url; throw IOException("down") } }
        assertEquals(urls, tried); assertEquals(0, failing.index)
        // A proxy that was adding bytes is kept for the engine's retry.
        val progressing = DownloadSources("sha", urls)
        assertThrows(IOException::class.java) { progressing.run({ false }, { retained }) { retained += 5; throw IOException("reset") } }
        assertEquals(0, progressing.index)
        // Cancellation is never mistaken for a failing source.
        val cancelled = DownloadSources("sha", urls)
        assertThrows(InterruptedIOException::class.java) { cancelled.run({ true }, { 0 }) { throw InterruptedIOException("cancelled") } }
        assertEquals(0, cancelled.index)
        // After a verification failure only the release URL is used, once.
        assertTrue(cancelled.directOnly()); assertFalse(cancelled.directOnly())
        assertEquals(release, cancelled.current)
        assertThrows(IOException::class.java) { cancelled.run({ false }, { 0 }) { url -> assertEquals(release, url); throw IOException("down") } }
        assertEquals(release, cancelled.current)
    }
}
