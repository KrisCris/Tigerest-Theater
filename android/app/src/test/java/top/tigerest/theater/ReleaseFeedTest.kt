package top.tigerest.theater

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.Instant
import java.util.Base64

/** The fixtures shared with tests/test_release_feed.cpp (tests/fixtures/make_release_feed_cases.mjs). */
class ReleaseFeedTest {
    private val fixtures = File("../../tests/fixtures")
    private val cases = JSONObject(File(fixtures, "release_feed_cases.json").readText())
    private val keys = mapOf(cases.getString("keyId") to cases.getString("publicKey"))
    private val now = Instant.parse(cases.getString("now"))

    private fun reason(envelope: ByteArray, at: Instant = now, with: Map<String, String> = keys): String =
        try { ReleaseFeed.open(envelope, at, with); "" } catch (rejected: ReleaseFeed.Rejected) { rejected.message.orEmpty() }

    @Test fun envelopesAreAcceptedOrRejectedForTheSameReasonsAsOnTheDesktop() {
        val envelopes = cases.getJSONArray("envelopes")
        for (i in 0 until envelopes.length()) {
            val case = envelopes.getJSONObject(i)
            assertEquals(case.getString("name"), case.getString("reason"), reason(case.getString("envelope").toByteArray()))
        }
        val valid = envelopes.getJSONObject(0)
        assertEquals("v2.0.0", ReleaseFeed.open(valid.getString("envelope").toByteArray(), now, keys).getJSONObject(0).getString("tag_name"))
    }

    @Test fun sizeLimitsComeFirst() {
        assertEquals("envelope over 2 MiB", reason(ByteArray(ReleaseFeed.MAX_ENVELOPE + 1) { ' '.code.toByte() }))
        val payload = Base64.getEncoder().encodeToString(ByteArray(ReleaseFeed.MAX_PAYLOAD + 1) { ' '.code.toByte() })
        val envelope = JSONObject().put("keyId", "test-1").put("payload", payload).put("signature", Base64.getEncoder().encodeToString(ByteArray(64)))
        assertEquals("payload over 1 MiB", reason(envelope.toString().toByteArray()))
    }

    @Test fun productionResponseVerifiesWithTheBuiltInKey() {
        val envelope = File(fixtures, "release_feed_production.json").readBytes()
        val releases = ReleaseFeed.open(envelope, Instant.parse("2026-10-21T10:53:13Z"))
        assertEquals(30, releases.length())
        assertEquals("v2.9.3", releases.getJSONObject(0).getString("tag_name"))
        assertEquals("release list older than 72 hours", reason(envelope, Instant.parse("2026-10-24T10:52:14Z"), ReleaseFeed.PRODUCTION_KEYS))
        val outer = JSONObject(envelope.toString(Charsets.UTF_8))
        val payload = String(Base64.getDecoder().decode(outer.getString("payload"))).replaceFirst("\"v2.9.3\"", "\"v2.9.4\"")
        outer.put("payload", Base64.getEncoder().encodeToString(payload.toByteArray()))
        assertEquals("bad signature", reason(outer.toString().toByteArray(), Instant.parse("2026-10-21T10:53:13Z"), ReleaseFeed.PRODUCTION_KEYS))
    }

    @Test fun signaturesFollowRfc8032() {
        val vectors = cases.getJSONArray("ed25519")
        for (i in 0 until vectors.length()) {
            val vector = vectors.getJSONObject(i)
            val hex = { name: String -> vector.getString(name).chunked(2).map { it.toInt(16).toByte() }.toByteArray() }
            assertEquals(vector.getString("name"), vector.getBoolean("valid"), Ed25519.verify(hex("signature"), hex("message"), hex("publicKey")))
        }
        val first = vectors.getJSONObject(0)
        val key = first.getString("publicKey").chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        assertTrue(!Ed25519.verify(ByteArray(63), ByteArray(0), key))
        assertTrue(!Ed25519.verify(ByteArray(64), ByteArray(0), key.copyOf(31)))
    }
}
