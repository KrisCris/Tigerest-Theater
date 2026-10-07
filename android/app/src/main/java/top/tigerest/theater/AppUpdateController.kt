package top.tigerest.theater

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.lang.ref.WeakReference
import java.util.concurrent.Executors

class AppUpdateController(private val context: Context, settings: SettingsStore) {
    private val prefs = context.getSharedPreferences("app-updates", Context.MODE_PRIVATE)
    private val source = AndroidAppUpdateSource(context)
    val engine = AppUpdateEngine(BuildConfig.VERSION_NAME, File(context.cacheDir, "app-updates"), source,
        { settings.bool("main", "checkForUpdates") }, { prefs.getString("skipped-version", "") ?: "" },
        { prefs.edit().putString("skipped-version", it).apply() }, Executors.newSingleThreadExecutor())
    private val main = Handler(Looper.getMainLooper())
    private var foreground = WeakReference<MainActivity>(null)
    private val installSession = AppUpdateInstallSession()
    @Volatile private var closed = false

    fun debugFixture(address: String) = source.debugFixture(address)
    fun install(automatic: Boolean = false): Boolean = engine.prepareInstall(automatic) { file -> main.post {
        if (closed) return@post
        val host = foreground.get()?.takeUnless { it.isFinishing || it.isDestroyed }
        val action = installSession.verified(host != null, context.packageManager.canRequestPackageInstalls())
        if (host != null) runCatching {
            when (action) {
                InstallAction.PERMISSION -> host.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
                InstallAction.INSTALL -> {
                    val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
                    host.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                }
                else -> Unit
            }
        }.onFailure { installSession.reset(); engine.installationReturned("无法打开系统安装界面，请重试") }
    } }

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
    fun close() { closed = true; foreground.clear(); installSession.reset(); main.removeCallbacksAndMessages(null); engine.close() }
}
