package top.tigerest.theater

import org.junit.Assert.*
import org.junit.Test

class PlaybackLoadingTest {
    @Test fun openingWaitsForPlaybackReadyEvenWhenInitialCacheIsEmptyOrPauseChanges() {
        val state = PlaybackState()
        assertFalse(state.loading)
        val generation = state.begin("video")
        assertTrue(state.loading)
        state.buffering(generation, false)
        state.update(generation, 0.0, true, 1.0)
        assertTrue("a pause or initial cache event is not the first rendered frame", state.loading)
        state.ready(generation)
        assertFalse(state.loading)
    }

    @Test fun realBufferingShowsAfterReadyButUserPauseHidesIt() {
        val state = PlaybackState()
        val generation = state.begin("video")
        state.ready(generation)
        state.buffering(generation, true)
        assertTrue(state.loading)
        state.update(generation, 12.0, true, 1.0)
        assertFalse("paused playback must not look stalled", state.loading)
        state.update(generation, 12.0, false, 1.0)
        assertTrue(state.loading)
        state.buffering(generation, false)
        assertFalse(state.loading)
    }

    @Test fun stoppedOrFailedSessionHidesLoadingAndIgnoresLateEvents() {
        val state = PlaybackState()
        val generation = state.begin("unreachable")
        assertTrue(state.loading)
        assertTrue(state.end(generation))
        state.buffering(generation, true)
        state.ready(generation)
        assertFalse(state.loading)
    }

    @Test fun replacingVideoRejectsOldReadinessAndCacheEvents() {
        val state = PlaybackState()
        val old = state.begin("old")
        val current = state.begin("new")
        state.ready(old)
        state.buffering(old, false)
        assertTrue(state.loading)
        state.ready(current)
        state.buffering(old, true)
        assertFalse(state.loading)
    }
}
