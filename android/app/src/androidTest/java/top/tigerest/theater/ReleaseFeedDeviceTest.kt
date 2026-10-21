package top.tigerest.theater

import okhttp3.OkHttpClient
import okhttp3.Request
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant
import java.util.concurrent.TimeUnit

/** Runs the release-feed checks on the device's ART and libraries, which the JVM unit tests cannot cover. */
class ReleaseFeedDeviceTest {
    private fun hex(text: String) = text.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    @Test fun deviceEd25519FollowsRfc8032() {
        // RFC 8032 section 7.1, tests 1 and 3.
        val key1 = hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a")
        val sig1 = hex("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b")
        val key3 = hex("fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025")
        val sig3 = hex("6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a")
        assertTrue(Ed25519.verify(sig1, ByteArray(0), key1))
        assertTrue(Ed25519.verify(sig3, hex("af82"), key3))
        assertTrue(!Ed25519.verify(sig3, hex("af83"), key3))
        assertTrue(!Ed25519.verify(sig1, ByteArray(0), key3))
    }

    @Test fun deployedFeedVerifiesOnTheDevice() {
        // Reads the deployed feed (GET only) with the built-in key and the device clock.
        val http = OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).followRedirects(false).build()
        http.newCall(Request.Builder().url(ReleaseFeed.ADDRESS).build()).execute().use { response ->
            assertEquals(200, response.code)
            val releases = ReleaseFeed.open(response.body!!.bytes(), Instant.now())
            assertTrue(releases.length() > 0)
            assertTrue(releases.getJSONObject(0).getString("tag_name").startsWith("v"))
        }
    }
}
