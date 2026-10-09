package top.tigerest.theater

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EpisodeQueueTest {
    @Test fun newLoadUsesPlaylistIdentityInsteadOfReplacingItWithMediaId() {
        val raw = JSONArray("""[{"Id":"1","PlaylistItemId":"q1"},{"Id":"2","PlaylistItemId":"q2"}]""")
        assertEquals("q2",EpisodeQueue.currentIdFor(raw,JSONObject("""{"Id":"2"}""")))
        raw.put(JSONObject("""{"Id":"2","PlaylistItemId":"q3"}"""))
        assertEquals("",EpisodeQueue.currentIdFor(raw,JSONObject("""{"Id":"2"}""")))
        assertEquals("q3",EpisodeQueue.currentIdFor(raw,JSONObject("""{"Id":"2","PlaylistItemId":"q3"}""")))
        assertEquals("",EpisodeQueue.currentIdFor(raw,JSONObject("""{"Id":"missing"}""")))
    }
    @Test fun duplicateMediaUsesQueueIdentityAndPreservesSeasonLabels() {
        val queue = EpisodeQueue.from(JSONArray("""[
            {"Id":"media","PlaylistItemId":"queue-a","Name":"开始","ParentIndexNumber":1,"IndexNumber":1},
            {"Id":"media","PlaylistItemId":"queue-b","Name":"归来","ParentIndexNumber":2,"IndexNumber":1},
            {"Id":"bad","Name":"missing queue identity"}
        ]"""), "queue-b")
        assertEquals(2, queue.items.size)
        assertEquals("S2 E1 · 归来", queue.items[1].label)
        assertEquals(1, queue.currentIndex)
        assertEquals("queue-a", queue.previousId)
        assertNull(queue.nextId)
    }
    @Test fun missingCurrentItemDisablesNavigationInsteadOfChoosingTheWrongEpisode() {
        val queue = EpisodeQueue.from(JSONArray("""[{"Id":"1","PlaylistItemId":"q1","Name":"电影"}]"""), "stale")
        assertEquals(-1, queue.currentIndex)
        assertNull(queue.previousId)
        assertNull(queue.nextId)
        assertEquals("电影", queue.items.single().label)
    }
}
