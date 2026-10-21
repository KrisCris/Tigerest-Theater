package top.tigerest.theater

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller

/** Status of the PackageInstaller session committed by [AppUpdateController]. */
class AppUpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION ->
                AppUpdateController.active.get()?.confirm(intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java))
            // The update stopped the old process; this runs in the new version. Open it again.
            PackageInstaller.STATUS_SUCCESS -> {
                DiagnosticsLog.app.record("info", "App update installed; reopening")
                runCatching {
                    context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                }.onFailure { DiagnosticsLog.app.record("warn", "Reopening after update failed: ${it.javaClass.simpleName}") }
            }
            else -> AppUpdateController.active.get()?.installFailed(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    companion object {
        const val ACTION = "top.tigerest.theater.APP_UPDATE_STATUS"
    }
}
