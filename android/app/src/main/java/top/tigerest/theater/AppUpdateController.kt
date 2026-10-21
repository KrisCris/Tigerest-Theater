package top.tigerest.theater

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import okhttp3.OkHttpClient
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** [playing] holds back an install queued by a finished download: the update replaces the running app. */
class AppUpdateController(private val context: Context, settings: SettingsStore, private val playing: () -> Boolean = { false }) {
    private val prefs = context.getSharedPreferences("app-updates", Context.MODE_PRIVATE)
    private val source = AndroidAppUpdateSource(context)
    val engine = AppUpdateEngine(BuildConfig.VERSION_NAME, File(context.cacheDir, "app-updates"), source,
        { settings.bool("main", "checkForUpdates") }, { prefs.getString("skipped-version", "") ?: "" },
        { prefs.edit().putString("skipped-version", it).apply() }, Executors.newSingleThreadExecutor(),
        remembered = { prefs.getString("remembered-release", "") ?: "" }, remember = { prefs.edit().putString("remembered-release", it).apply() })
    private val main = Handler(Looper.getMainLooper())
    private var foreground = WeakReference<MainActivity>(null)
    private val installSession = AppUpdateInstallSession()
    @Volatile private var closed = false
    private val folders = NetdiskFolder(OkHttpNetdisk(OkHttpClient.Builder().connectTimeout(8, TimeUnit.SECONDS).readTimeout(10, TimeUnit.SECONDS)
        .callTimeout(10, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build(), "Tigerest-Theater-Android/${BuildConfig.VERSION_NAME}"))
    private val mirrorWork = Executors.newSingleThreadExecutor()
    private val openingMirror = AtomicBoolean()
    private val installWork = Executors.newSingleThreadExecutor()

    init { active = WeakReference(this) }

    /** Opens the release's netdisk folder page, or the share; the Baidu Netdisk app may take over a Baidu page. */
    fun openMirror(kind: String): Boolean {
        val (share, version) = engine.mirror(kind) ?: return false
        if (!openingMirror.compareAndSet(false, true)) return true
        mirrorWork.execute {
            val page = folders.resolve(share, version)
            openingMirror.set(false)
            main.post { if (!closed) foreground.get()?.takeUnless { it.isFinishing || it.isDestroyed }?.openExternal(page) }
        }
        return true
    }

    fun debugFixture(address: String) = source.debugFixture(address)
    fun install(automatic: Boolean = false): Boolean {
        if (automatic && playing() && engine.snapshot().optBoolean("installAfterDownload")) {
            main.removeCallbacks(installAfterPlayback); main.postDelayed(installAfterPlayback, 5000); return true
        }
        return handOver(automatic)
    }
    private val installAfterPlayback: Runnable = Runnable { if (!closed) install(true) }

    private fun handOver(automatic: Boolean): Boolean = engine.prepareInstall(automatic) { file -> main.post {
        if (closed) return@post
        val host = foreground.get()?.takeUnless { it.isFinishing || it.isDestroyed }
        val action = installSession.verified(host != null, context.packageManager.canRequestPackageInstalls())
        if (host != null) runCatching {
            when (action) {
                InstallAction.PERMISSION -> host.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                InstallAction.INSTALL -> installWork.execute { commit(file) }
                else -> Unit
            }
        }.onFailure { installSession.reset(); engine.installationReturned("无法打开系统安装界面，请重试") }
    } }

    /**
     * Installs through a PackageInstaller session. With UPDATE_PACKAGES_WITHOUT_USER_ACTION a self-update
     * needs no confirmation screen; the system replaces and stops this app, and [AppUpdateInstallReceiver]
     * starts the new version. Otherwise the system asks for confirmation (STATUS_PENDING_USER_ACTION).
     */
    private fun commit(file: File) {
        val installer = context.packageManager.packageInstaller
        var id = -1
        runCatching {
            val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
                setAppPackageName(context.packageName)
                setSize(file.length())
                setInstallReason(PackageManager.INSTALL_REASON_USER)
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
            id = installer.createSession(params)
            installer.openSession(id).use { session ->
                session.openWrite("update.apk", 0, file.length()).use { output ->
                    file.inputStream().use { it.copyTo(output, 1 shl 16) }
                    session.fsync(output)
                }
                val status = Intent(context, AppUpdateInstallReceiver::class.java).setAction(AppUpdateInstallReceiver.ACTION)
                session.commit(PendingIntent.getBroadcast(context, id, status, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE).intentSender)
            }
            DiagnosticsLog.app.record("info", "App update session $id committed")
        }.onFailure { failure ->
            if (id >= 0) runCatching { installer.abandonSession(id) }
            DiagnosticsLog.app.record("warn", "App update session failed: ${failure.javaClass.simpleName}")
            main.post { installSession.reset(); engine.installationReturned("无法开始安装更新，请重试") }
        }
    }

    /** The system wants the user to confirm, e.g. when it does not allow an unattended update. */
    internal fun confirm(prompt: Intent?) = main.post {
        val host = foreground.get()?.takeUnless { it.isFinishing || it.isDestroyed }
        if (closed) return@post
        if (prompt == null || host == null || runCatching { host.startActivity(prompt) }.isFailure) {
            installSession.reset(); engine.installationReturned("请回到应用后再次点击安装")
        }
    }

    internal fun installFailed(status: Int, message: String?) = main.post {
        if (closed) return@post
        DiagnosticsLog.app.record("warn", "App update install status $status: ${message.orEmpty().take(200)}")
        installSession.reset()
        engine.installationReturned(if (status == PackageInstaller.STATUS_FAILURE_ABORTED) "安装已取消，可以再次点击安装" else "更新安装失败，请重试")
    }

    fun resumed(activity: MainActivity) {
        foreground = WeakReference(activity)
        when (installSession.resumed(context.packageManager.canRequestPackageInstalls())) {
            InstallAction.REVERIFY -> { engine.installationReturned(); install() }
            InstallAction.DENIED -> engine.installationReturned("未允许此应用安装更新；可再次点击安装并授权")
            InstallAction.RETURNED -> engine.installationReturned("已返回应用；若尚未完成更新，可再次点击安装")
            else -> Unit
        }
    }
    fun paused(activity: MainActivity) { if (foreground.get() === activity) foreground.clear() }
    fun close() { closed = true; foreground.clear(); installSession.reset(); main.removeCallbacksAndMessages(null); mirrorWork.shutdownNow(); installWork.shutdown(); engine.close() }

    companion object {
        /** The live controller, for install status broadcasts. */
        @Volatile internal var active = WeakReference<AppUpdateController>(null)
    }
}
