package top.tigerest.theater

enum class InstallAction { NONE, PERMISSION, INSTALL, REVERIFY, DENIED, RETURNED }

/** Kept in the ViewModel: returning from an OS screen consumes a single pending request. */
class AppUpdateInstallSession {
    private var pending = InstallAction.NONE
    fun verified(foreground: Boolean, permission: Boolean): InstallAction {
        pending = if (!foreground) InstallAction.REVERIFY else if (!permission) InstallAction.PERMISSION else InstallAction.INSTALL
        return if (foreground) pending else InstallAction.NONE
    }
    fun resumed(permission: Boolean): InstallAction {
        val action = when (pending) {
            InstallAction.REVERIFY -> InstallAction.REVERIFY
            InstallAction.PERMISSION -> if (permission) InstallAction.REVERIFY else InstallAction.DENIED
            InstallAction.INSTALL -> InstallAction.RETURNED
            else -> InstallAction.NONE
        }
        reset(); return action
    }
    fun reset() { pending = InstallAction.NONE }
}
