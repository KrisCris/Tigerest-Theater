package top.tigerest.theater

import java.io.File
import java.io.IOException
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import org.json.JSONArray
import org.json.JSONObject

private class UpdateRetryExhausted(message: String) : IllegalStateException(message)

interface AppUpdateSource {
    fun releases(): JSONArray
    /** An IOException keeps the saved prefix for a later attempt; permanent validation failures do not retry. */
    fun download(candidate: AppUpdateCandidate, destination: File, cancelled: () -> Boolean, progress: (Long) -> Unit)
    fun validateApk(file: File, candidate: AppUpdateCandidate)
    fun cancel()
}

class AppUpdateEngine(private val currentVersion: String, private val directory: File, private val source: AppUpdateSource,
    private val enabled: () -> Boolean, private val skipped: () -> String, private val saveSkipped: (String) -> Unit,
    private val executor: Executor,
    private val retryDelays: List<Long> = listOf(2_000, 5_000, 10_000, 20_000, 30_000)) {
    @Volatile var changed: (JSONObject) -> Unit = {}
    private var candidate: AppUpdateCandidate? = null
    private var downloaded: File? = null
    private var status = "idle"
    private var received = 0L
    private var error = ""
    private var manual = false
    private var deferred = false
    private var installAfterDownload = false
    private var automaticChecked = false
    private var token = 0L
    private var closed = false
    private var retrying = false
    private var retryAttempt = 0
    private var retryDelay = 0L
    // A cancelled writer must release this cache before a replacement generation can use it.
    private val transferLock = Any()
    init {
        directory.mkdirs()
        require(retryDelays.all { it >= 0 })
        // Old process-numbered packages have no stable identity; SHA-keyed packages survive restarts.
        directory.listFiles()?.filter { it.name.matches(Regex("update-[0-9]{1,19}\\.(part|apk)")) }?.forEach { it.delete() }
    }
    private fun partial(selected: AppUpdateCandidate) = File(directory, "update-${selected.sha256}.part")
    private fun complete(selected: AppUpdateCandidate) = File(directory, "update-${selected.sha256}.apk")
    private fun retained(selected: AppUpdateCandidate?): Long = selected?.let {
        maxOf(resumeOffset(partial(it), it), resumeOffset(complete(it), it))
    } ?: 0L
    private fun clearRetry() { retrying = false; retryAttempt = 0; retryDelay = 0 }
    private fun discard(selected: AppUpdateCandidate) { partial(selected).delete(); complete(selected).delete() }
    private fun cleanSuperseded(selected: AppUpdateCandidate?) {
        val keep = selected?.let { setOf(partial(it).name, complete(it).name) } ?: emptySet()
        directory.listFiles()?.filter { it.name.matches(Regex("update-[0-9a-f]{64}\\.(part|apk)")) && it.name !in keep }?.forEach { it.delete() }
    }
    private fun pause(milliseconds: Long, generation: Long) {
        val end = System.nanoTime() + milliseconds * 1_000_000
        while (active(generation)) {
            val left = (end - System.nanoTime()) / 1_000_000
            if (left <= 0) return
            Thread.sleep(minOf(left, 100))
        }
    }
    @Synchronized fun snapshot(): JSONObject = JSONObject().put("status", status).put("currentVersion", currentVersion)
        .put("version", candidate?.version ?: "").put("releaseUrl", candidate?.releaseUrl ?: "").put("notes", candidate?.notes ?: "")
        .put("size", candidate?.size ?: 0).put("received", received).put("error", error)
        .put("installLabel", "安装更新").put("manual", manual).put("platform", "android").put("deferred", deferred)
        .put("installAfterDownload", installAfterDownload)
        .put("resumable", candidate != null && received > 0 && status in setOf("available", "downloading", "error"))
        .put("retrying", retrying).put("retryAttempt", retryAttempt).put("retryLimit", retryDelays.size).put("retryDelay", retryDelay)
    private fun publish() { changed(snapshot()) }
    @Synchronized private fun active(generation: Long) = !closed && generation == token
    private fun task(generation: Long, action: () -> Unit) {
        executor.execute {
            if (!active(generation)) return@execute
            try { action() } catch (failure: Exception) {
                synchronized(this) {
                    if (active(generation)) {
                        status = "error"; installAfterDownload = false; clearRetry(); received = retained(candidate)
                        error = if (failure is IllegalArgumentException || failure is IllegalStateException) failure.message?.take(180) ?: "更新失败，请重试" else "无法完成更新，请检查网络后重试"
                        publish()
                    }
                }
            }
        }
    }
    @Synchronized fun check(manual: Boolean): Boolean {
        if (closed) return false
        if (!manual) {
            if (automaticChecked) return true
            automaticChecked = true
            if (!enabled()) return true
        } else { automaticChecked = true; this.manual = true; deferred = false }
        if (status in setOf("checking", "downloading", "ready", "installing")) { publish(); return true }
        this.manual = manual; deferred = false; installAfterDownload = false; candidate = null; downloaded = null
        status = "checking"; received = 0; error = ""; clearRetry(); val generation = ++token; publish()
        task(generation) {
            val selected = AppUpdatePolicy.select(source.releases(), currentVersion)
            synchronized(transferLock) {
                synchronized(this) {
                    if (!active(generation)) return@task
                    candidate = selected?.takeUnless { !this.manual && it.version == skipped() }
                    cleanSuperseded(candidate)
                    received = retained(candidate)
                    status = if (candidate == null) "current" else "available"
                    publish()
                }
            }
        }
        return true
    }
    @Synchronized fun skip(): Boolean {
        if (closed || status == "installing") return false
        val selected = candidate ?: return false
        saveSkipped(selected.version); cancel(); candidate = null; status = "idle"; received = 0; error = ""; deferred = true
        val generation = token
        task(generation) { synchronized(transferLock) { synchronized(this) { if (active(generation)) discard(selected) } } }
        publish(); return true
    }
    @Synchronized fun defer(): Boolean { if (closed) return false; deferred = true; publish(); return true }
    @Synchronized fun cancel(): Boolean {
        if (closed || status == "installing") return false
        token++; installAfterDownload = false; source.cancel(); downloaded = null; clearRetry()
        received = retained(candidate); error = ""; status = if (candidate == null) "idle" else "available"; publish(); return true
    }
    @Synchronized fun download(): Boolean {
        if (closed || status in setOf("checking", "downloading", "installing")) return false
        val selected = candidate ?: return false
        manual = true; deferred = false; installAfterDownload = true
        if (status == "ready") { publish(); return true }
        val generation = ++token
        status = "downloading"; error = ""; received = retained(selected); deferred = false; clearRetry(); publish()
        task(generation) {
            synchronized(transferLock) {
                if (!active(generation)) return@task
                val part = partial(selected)
                val complete = complete(selected)
                cleanSuperseded(selected)
                var failures = 0
                var highWater = resumeOffset(part, selected)
                try {
                    while (resumeOffset(part, selected) != selected.size && resumeOffset(complete, selected) != selected.size) {
                        if (!active(generation)) return@task
                        val beforeHighWater = highWater
                        try {
                            source.download(selected, part, { !active(generation) }) { bytes ->
                                val gained = bytes > highWater
                                if (gained) highWater = bytes
                                synchronized(this) { if (active(generation)) { received = bytes; if (gained) { error = ""; clearRetry() }; publish() } }
                            }
                            // A source returning a short body is also an interrupted attempt.
                            if (part.length() != selected.size) throw IOException("更新包下载中断")
                        } catch (failure: IOException) {
                            if (!active(generation)) return@task
                            // All expected bytes are present even if the connection failed at its end.
                            if (part.length() == selected.size) break
                            highWater = maxOf(highWater, resumeOffset(part, selected))
                            if (highWater > beforeHighWater) failures = 0
                            if (failures >= retryDelays.size) throw UpdateRetryExhausted("更新下载多次中断，已保留下载进度。请检查网络后重试下载。")
                            val delay = retryDelays[failures++]
                            val attempt = failures
                            synchronized(this) {
                                if (!active(generation)) return@task
                                received = retained(selected); retrying = true; retryAttempt = attempt; retryDelay = (delay + 999) / 1000
                                error = "下载中断，$retryDelay 秒后自动继续（第 $attempt/${retryDelays.size} 次重试）。"; publish()
                            }
                            pause(delay, generation)
                            synchronized(this) {
                                if (!active(generation)) return@task
                                retryDelay = 0; error = "正在重新连接（第 $attempt/${retryDelays.size} 次重试）…"; publish()
                            }
                        }
                    }
                    if (!active(generation)) return@task
                    val packageFile = if (resumeOffset(complete, selected) == selected.size) complete else part
                    try {
                        AppUpdatePolicy.verifyFile(packageFile, selected)
                        source.validateApk(packageFile, selected)
                    } catch (failure: Exception) { if (active(generation)) discard(selected); throw failure }
                    synchronized(this) {
                        if (!active(generation)) return@task
                        if (packageFile == part) { complete.delete(); check(part.renameTo(complete)) { "无法保存更新包，请重试" } }
                        downloaded = complete; status = "ready"; received = selected.size; error = ""; clearRetry(); publish()
                    }
                } catch (failure: Exception) {
                    if (!active(generation)) return@task
                    // Network interruption preserves the prefix. Package/header/identity failures discard it.
                    if (failure !is IOException && failure !is UpdateRetryExhausted) discard(selected)
                    throw failure
                } finally {
                    synchronized(this) {
                        // Cancellation can happen while a read is finishing; publish its final saved count.
                        if (!closed && token == generation + 1 && status == "available" && candidate == selected) {
                            received = retained(selected); publish()
                        }
                    }
                }
            }
        }
        return true
    }
    @Synchronized fun prepareInstall(automatic: Boolean = false, ready: (File) -> Unit): Boolean {
        if (closed || status != "ready") return false
        if (automatic && !installAfterDownload) return false
        val selected = candidate ?: return false
        val file = downloaded ?: return false
        val generation = ++token
        // Consume before notifying documents: a replayed ready signal cannot hand off twice.
        installAfterDownload = false
        status = "installing"; error = ""; deferred = false; publish()
        task(generation) {
            try {
                AppUpdatePolicy.verifyFile(file, selected)
                source.validateApk(file, selected)
            } catch (failure: Exception) {
                file.delete(); synchronized(this) { downloaded = null; received = retained(selected) }; throw failure
            }
            synchronized(this) { if (active(generation)) ready(file) }
        }
        return true
    }
    @Synchronized fun installationReturned(error: String = "") {
        if (closed || status != "installing") return
        status = if (downloaded?.isFile == true) "ready" else "error"; this.error = error; publish()
    }
    @Synchronized fun close() { if (closed) return; closed = true; installAfterDownload = false; clearRetry(); token++; source.cancel(); changed = {}; (executor as? ExecutorService)?.shutdownNow() }
}
