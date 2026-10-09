package top.tigerest.theater

import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.IOException
import java.nio.file.Files
import java.util.concurrent.Executor

class AppUpdateResumeTest {
    private val hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    private class Queue : Executor {
        val tasks = ArrayDeque<Runnable>()
        override fun execute(command: Runnable) { tasks.add(command) }
        fun run() { while (tasks.isNotEmpty()) tasks.removeFirst().run() }
    }
    private inner class Source : AppUpdateSource {
        var downloadCalls = 0
        var validated = 0
        var transfer: (File, () -> Boolean, (Long) -> Unit) -> Unit = { file, _, progress ->
            file.writeText("abc"); progress(3)
        }
        override fun releases() = JSONArray("""[{"tag_name":"v2.5.0","draft":false,"prerelease":false,"html_url":"https://github.com/Tigerest/Tigerest-Theater/releases/tag/v2.5.0","body":"Fixed","assets":[{"name":"TigerestTheater-2.5.0-android.apk","state":"uploaded","size":3,"digest":"sha256:$hash","browser_download_url":"https://github.com/Tigerest/Tigerest-Theater/releases/download/v2.5.0/TigerestTheater-2.5.0-android.apk"}]}]""")
        override fun download(candidate: AppUpdateCandidate, destination: File, cancelled: () -> Boolean, progress: (Long) -> Unit) {
            downloadCalls++; transfer(destination, cancelled, progress)
        }
        override fun validateApk(file: File, candidate: AppUpdateCandidate) { validated++ }
        override fun cancel() {}
    }
    private fun scenario(action: (AppUpdateEngine, Source, Queue, File) -> Unit) {
        val source = Source(); val queue = Queue(); val directory = Files.createTempDirectory("update-resume").toFile()
        val engine = AppUpdateEngine("2.4.1", directory, source, { true }, { "" }, {}, queue, List(5) { 0L })
        try { action(engine, source, queue, directory) } finally { engine.close(); directory.deleteRecursively() }
    }

    @Test fun cachedCompletePartialIsVerifiedWithoutAnotherDownload() = scenario { engine, source, queue, directory ->
        File(directory, "update-$hash.part").writeText("abc")
        engine.check(true); queue.run()
        assertEquals(3L, engine.snapshot().getLong("received"))
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertEquals(0, source.downloadCalls)
        assertEquals(1, source.validated)
    }

    @Test fun pausedPrefixRemainsVisibleAndContinueUsesIt() = scenario { engine, source, queue, directory ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress -> file.writeText("a"); progress(1); engine.cancel(); throw IOException("cancelled") }
        engine.download(); queue.run()
        assertEquals("available", engine.snapshot().getString("status"))
        assertEquals(1L, engine.snapshot().getLong("received"))
        assertTrue(engine.snapshot().getBoolean("resumable"))
        assertFalse(engine.snapshot().getBoolean("installAfterDownload"))
        assertEquals("a", File(directory, "update-$hash.part").readText())
        source.transfer = { file, _, progress -> assertEquals("a", file.readText()); file.appendText("bc"); progress(3) }
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertTrue(engine.snapshot().getBoolean("installAfterDownload"))
    }

    @Test fun interruptedDownloadAutomaticallyResumesItsSavedPrefix() = scenario { engine, source, queue, _ ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress ->
            if (source.downloadCalls == 1) { file.writeText("a"); progress(1); throw IOException("connection lost") }
            assertEquals("a", file.readText()); file.appendText("bc"); progress(3)
        }
        val states = mutableListOf<org.json.JSONObject>(); engine.changed = { states.add(it) }
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertEquals(2, source.downloadCalls)
        assertTrue(states.any { it.optBoolean("retrying") && it.optInt("retryLimit") == 5 && it.optInt("retryAttempt") == 1 })
        assertFalse(engine.snapshot().getBoolean("retrying"))
    }

    @Test fun completePartialAfterInterruptedResponseIsVerifiedInsteadOfFetchedAgain() = scenario { engine, source, queue, _ ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress -> file.writeText("abc"); progress(3); throw IOException("final network error") }
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertEquals(1, source.downloadCalls)
        assertEquals(1, source.validated)
    }

    @Test fun fiveNoProgressRetriesEndWithAResumableError() = scenario { engine, source, queue, directory ->
        File(directory, "update-$hash.part").writeText("a")
        engine.check(true); queue.run()
        source.transfer = { _, _, _ -> throw IOException("offline") }
        val attempts = mutableListOf<Int>()
        engine.changed = { if (it.optBoolean("retrying") && it.optString("error").contains("自动继续")) attempts.add(it.optInt("retryAttempt")) }
        engine.download(); queue.run()
        assertEquals(6, source.downloadCalls)
        assertEquals(listOf(1, 2, 3, 4, 5), attempts)
        assertEquals("error", engine.snapshot().getString("status"))
        assertEquals(1L, engine.snapshot().getLong("received"))
        assertTrue(engine.snapshot().getBoolean("resumable"))
        assertFalse(engine.snapshot().getBoolean("retrying"))
        assertFalse(engine.snapshot().getBoolean("installAfterDownload"))
        assertEquals("a", File(directory, "update-$hash.part").readText())
    }

    @Test fun newBytesResetTheConsecutiveNoProgressBudget() = scenario { engine, source, queue, _ ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress ->
            when (source.downloadCalls) {
                in 1..5, in 7..10 -> throw IOException("offline")
                6 -> { file.writeText("a"); progress(1); throw IOException("saved one byte") }
                11 -> { assertEquals("a", file.readText()); file.appendText("bc"); progress(3) }
                else -> fail("Retry budget did not reset correctly")
            }
        }
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertEquals(11, source.downloadCalls)
    }

    @Test fun corruptCompletePartialIsDeletedWithoutDownloadingOrInstalling() = scenario { engine, source, queue, directory ->
        File(directory, "update-$hash.part").writeText("abd")
        engine.check(true); queue.run(); engine.download(); queue.run()
        assertEquals("error", engine.snapshot().getString("status"))
        assertEquals(0, source.downloadCalls); assertEquals(0, source.validated)
        assertFalse(engine.snapshot().getBoolean("resumable"))
        assertEquals(0L, engine.snapshot().getLong("received"))
        assertFalse(engine.prepareInstall {})
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun cacheCleanupLeavesFilesOutsideUpdaterNamingAlone() = scenario { engine, _, queue, directory ->
        val unrelated = File(directory, "notes.part").apply { writeText("keep") }
        val superseded = File(directory, "update-${"f".repeat(64)}.part").apply { writeText("old") }
        engine.check(true); queue.run(); engine.download(); queue.run()
        assertEquals("keep", unrelated.readText()); assertFalse(superseded.exists())
        assertEquals("ready", engine.snapshot().getString("status"))
    }

    @Test fun skipDiscardsItsPartialAndResumeIntent() = scenario { engine, source, queue, directory ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress -> file.writeText("a"); progress(1); engine.skip(); throw IOException("cancelled") }
        engine.download(); queue.run()
        assertEquals("idle", engine.snapshot().getString("status"))
        assertFalse(engine.snapshot().getBoolean("installAfterDownload"))
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun processRestartRecoversSavedPrefixWithoutInstallIntent() {
        val directory = Files.createTempDirectory("update-restart").toFile()
        val source = Source(); val queue = Queue()
        fun engine() = AppUpdateEngine("2.4.1", directory, source, { true }, { "" }, {}, queue, List(5) { 0L })
        val first = engine()
        try {
            first.check(true); queue.run()
            source.transfer = { file, _, progress -> file.writeText("ab"); progress(2); first.close(); throw IOException("process closed") }
            first.download(); queue.run()
            val second = engine()
            try {
                second.check(true); queue.run()
                assertEquals(2L, second.snapshot().getLong("received"))
                assertTrue(second.snapshot().getBoolean("resumable"))
                assertFalse(second.snapshot().getBoolean("installAfterDownload"))
                source.transfer = { file, _, progress -> assertEquals("ab", file.readText()); file.appendText("c"); progress(3) }
                second.download(); queue.run()
                assertEquals("ready", second.snapshot().getString("status"))
            } finally { second.close() }
        } finally { first.close(); directory.deleteRecursively() }
    }

    @Test fun cancelledLateFailureCannotDeletePrefixOwnedByContinue() = scenario { engine, source, queue, _ ->
        engine.check(true); queue.run()
        source.transfer = { file, _, progress ->
            if (source.downloadCalls == 1) {
                file.writeText("a"); progress(1); engine.cancel(); engine.download()
                throw IllegalArgumentException("late invalid response from cancelled request")
            }
            assertEquals("a", file.readText()); file.appendText("bc"); progress(3)
        }
        engine.download(); queue.run()
        assertEquals("ready", engine.snapshot().getString("status"))
        assertEquals(2, source.downloadCalls)
    }

    @Test fun replacingTheSamePrefixDoesNotResetTheRetryBudget() = scenario { engine, source, queue, directory ->
        File(directory, "update-$hash.part").writeText("a")
        engine.check(true); queue.run()
        source.transfer = { file, _, progress ->
            if (source.downloadCalls > 8) throw IllegalStateException("fixture stops an unbounded retry loop")
            file.writeText(""); progress(0); file.writeText("a"); progress(1)
            throw IOException("server ignored Range then disconnected")
        }
        engine.download(); queue.run()
        assertEquals(6, source.downloadCalls)
        assertEquals("error", engine.snapshot().getString("status"))
        assertTrue(engine.snapshot().getBoolean("resumable"))
        assertEquals("a", File(directory, "update-$hash.part").readText())
    }

    @Test fun fluctuatingPrefixesBelowTheSavedMaximumDoNotResetTheRetryBudget() = scenario { engine, source, queue, directory ->
        File(directory, "update-$hash.part").writeText("ab")
        engine.check(true); queue.run()
        source.transfer = { file, _, progress ->
            if (source.downloadCalls > 8) throw IllegalStateException("fixture stops an unbounded retry loop")
            file.writeText(""); progress(0)
            file.writeText(if (source.downloadCalls % 2 == 1) "a" else "ab"); progress(file.length())
            throw IOException("server repeatedly restarted transfer")
        }
        engine.download(); queue.run()
        assertEquals(6, source.downloadCalls)
        assertEquals("error", engine.snapshot().getString("status"))
        assertEquals(2L, engine.snapshot().getLong("received"))
        assertTrue(engine.snapshot().getBoolean("resumable"))
    }
}
