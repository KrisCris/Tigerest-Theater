package top.tigerest.theater

import java.io.File
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import org.json.JSONArray
import org.json.JSONObject

interface AppUpdateSource {
    fun releases(): JSONArray
    fun download(candidate: AppUpdateCandidate, destination: File, cancelled: () -> Boolean, progress: (Long) -> Unit)
    fun validateApk(file: File, candidate: AppUpdateCandidate)
    fun cancel()
}

class AppUpdateEngine(private val currentVersion: String, private val directory: File, private val source: AppUpdateSource,
    private val enabled: () -> Boolean, private val skipped: () -> String, private val saveSkipped: (String) -> Unit,
    private val executor: Executor) {
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
    init {
        directory.mkdirs()
        // This directory is private to the updater. Interrupted process downloads cannot be resumed safely.
        directory.listFiles()?.filter { it.name.matches(Regex("update-[0-9]+\\.(part|apk)")) }?.forEach { it.delete() }
    }
    @Synchronized fun snapshot(): JSONObject = JSONObject().put("status", status).put("currentVersion", currentVersion)
        .put("version", candidate?.version ?: "").put("releaseUrl", candidate?.releaseUrl ?: "").put("notes", candidate?.notes ?: "")
        .put("size", candidate?.size ?: 0).put("received", received).put("error", error)
        .put("installLabel", "安装更新").put("manual", manual).put("platform", "android").put("deferred", deferred)
        .put("installAfterDownload", installAfterDownload)
    private fun publish() { changed(snapshot()) }
    @Synchronized private fun active(generation: Long) = !closed && generation == token
    private fun task(generation: Long, action: () -> Unit) {
        executor.execute {
            if (!active(generation)) return@execute
            try { action() } catch (failure: Exception) {
                synchronized(this) {
                    if (active(generation)) {
                        status = "error"; installAfterDownload = false
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
        this.manual = manual; deferred = false; installAfterDownload = false; candidate = null; downloaded?.delete(); downloaded = null
        status = "checking"; received = 0; error = ""; val generation = ++token; publish()
        task(generation) {
            val selected = AppUpdatePolicy.select(source.releases(), currentVersion)
            synchronized(this) {
                if (!active(generation)) return@task
                candidate = selected?.takeUnless { !this.manual && it.version == skipped() }
                status = if (candidate == null) "current" else "available"
                publish()
            }
        }
        return true
    }
    @Synchronized fun skip(): Boolean {
        if (closed || status == "installing") return false
        val version = candidate?.version ?: return false
        saveSkipped(version); cancel(); candidate = null; status = "idle"; error = ""; deferred = true; publish(); return true
    }
    @Synchronized fun defer(): Boolean { if (closed) return false; deferred = true; publish(); return true }
    @Synchronized fun cancel(): Boolean {
        if (closed || status == "installing") return false
        token++; installAfterDownload = false; source.cancel(); downloaded?.delete(); downloaded = null
        received = 0; error = ""; status = if (candidate == null) "idle" else "available"; publish(); return true
    }
    @Synchronized fun download(): Boolean {
        if (closed || status in setOf("checking", "downloading", "installing")) return false
        val selected = candidate ?: return false
        manual = true; deferred = false; installAfterDownload = true
        if (status == "ready") { publish(); return true }
        val generation = ++token
        status = "downloading"; error = ""; received = 0; deferred = false; publish()
        task(generation) {
            val part = File(directory, "update-$generation.part")
            val complete = File(directory, "update-$generation.apk")
            try {
                source.download(selected, part, { !active(generation) }) { bytes ->
                    synchronized(this) { if (active(generation)) { received = bytes; publish() } }
                }
                if (!active(generation)) return@task
                AppUpdatePolicy.verifyFile(part, selected)
                source.validateApk(part, selected)
                synchronized(this) {
                    if (!active(generation)) return@task
                    check(part.renameTo(complete)) { "无法保存更新包，请重试" }
                    downloaded = complete; status = "ready"; received = selected.size; publish()
                }
            } finally { part.delete() }
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
                file.delete(); synchronized(this) { downloaded = null }; throw failure
            }
            synchronized(this) { if (active(generation)) ready(file) }
        }
        return true
    }
    @Synchronized fun installationReturned(error: String = "") {
        if (closed || status != "installing") return
        status = if (downloaded?.isFile == true) "ready" else "error"; this.error = error; publish()
    }
    @Synchronized fun close() { if (closed) return; closed = true; installAfterDownload = false; token++; source.cancel(); changed = {}; (executor as? ExecutorService)?.shutdownNow() }
}
