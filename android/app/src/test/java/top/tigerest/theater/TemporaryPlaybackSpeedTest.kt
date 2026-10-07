package top.tigerest.theater

import org.junit.Assert.*
import org.junit.Test

class TemporaryPlaybackSpeedTest {
    @Test fun releaseRestoresExactSpeedAndRepeatedStartDoesNotOverwriteIt() {
        val speed = TemporaryPlaybackSpeed()
        assertEquals(2.0, speed.begin(1.25))
        assertNull(speed.begin(2.0))
        assertEquals(1.25, speed.end())
        assertNull(speed.end())
    }

    @Test fun holdingNeverSlowsAnAlreadyFasterUserSetting() {
        val speed = TemporaryPlaybackSpeed()
        assertEquals(3.0, speed.begin(3.0))
        assertEquals(3.0, speed.end())
    }

    @Test fun canceledHoldCanStartAgainWithAnotherUserSpeed() {
        val speed = TemporaryPlaybackSpeed()
        speed.begin(.75)
        assertEquals(.75, speed.end())
        assertEquals(2.0, speed.begin(1.75))
        assertEquals(1.75, speed.end())
    }
}
