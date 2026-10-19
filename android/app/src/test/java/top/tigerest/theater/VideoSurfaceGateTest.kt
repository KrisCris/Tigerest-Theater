package top.tigerest.theater

import org.junit.Assert.*
import org.junit.Test

class VideoSurfaceGateTest {
    private val started = mutableListOf<Pair<Long, String>>()
    private val gate = VideoSurfaceGate { generation, url -> started += generation to url }

    @Test fun firstVideoWaitsForTheSurfaceAndStartsOnceItIsAttached() {
        assertFalse("mpv cannot open its video output before the surface exists", gate.load(1, "video", video = true))
        assertTrue(started.isEmpty())
        gate.attached()
        assertEquals(listOf(1L to "video"), started)
        gate.attached()
        assertEquals("a surface mounted again does not restart the file", 1, started.size)
    }

    @Test fun audioStartsWithoutASurface() {
        assertTrue(gate.load(1, "song", video = false))
        assertEquals(listOf(1L to "song"), started)
        gate.attached()
        assertEquals(1, started.size)
    }

    @Test fun onlyTheLatestOfQuickReplacementsStarts() {
        gate.load(1, "first", video = true)
        gate.load(2, "second", video = true)
        gate.attached()
        assertEquals(listOf(2L to "second"), started)
    }

    @Test fun audioReplacingAWaitingVideoDropsTheVideo() {
        gate.load(1, "video", video = true)
        gate.load(2, "song", video = false)
        gate.attached()
        assertEquals(listOf(2L to "song"), started)
    }

    @Test fun stopBeforeTheSurfaceStartsNothing() {
        gate.load(1, "video", video = true)
        gate.cancel()
        gate.attached()
        assertTrue(started.isEmpty())
    }

    @Test fun remountedSurfaceKeepsPlayingAndHoldsTheNextVideo() {
        gate.attached()
        assertTrue("a shown surface starts the video at once", gate.load(1, "first", video = true))
        gate.detached(); gate.attached()
        assertEquals(listOf(1L to "first"), started)
        gate.detached()
        assertFalse(gate.load(2, "second", video = true))
        assertEquals(1, started.size)
        gate.attached()
        assertEquals(listOf(1L to "first", 2L to "second"), started)
    }

    @Test fun aSurfaceLostBeforeItWasUsedKeepsTheVideoWaiting() {
        gate.load(1, "video", video = true)
        gate.detached()
        assertTrue(started.isEmpty())
        gate.attached()
        assertEquals(listOf(1L to "video"), started)
    }
}
