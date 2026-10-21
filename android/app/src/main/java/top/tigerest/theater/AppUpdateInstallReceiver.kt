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
            // This runs in the new version. It cannot reopen itself: Android blocks activity starts
            // from a background receiver, so the system's install screen offers to open it instead.
            PackageInstaller.STATUS_SUCCESS -> DiagnosticsLog.app.record("info", "App update installed")
            else -> AppUpdateController.active.get()?.installFailed(status, intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE))
        }
    }

    companion object {
        const val ACTION = "top.tigerest.theater.APP_UPDATE_STATUS"
    }
}
