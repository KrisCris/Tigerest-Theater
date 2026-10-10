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
}
