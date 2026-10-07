package top.tigerest.theater

import org.junit.Assert.*
import org.junit.Test

class AppUpdateInstallSessionTest {
    @Test fun permissionGrantReverifiesAndDenialDoesNotReprompt() {
        val flow = AppUpdateInstallSession()
        assertEquals(InstallAction.PERMISSION, flow.verified(true, false))
        assertEquals(InstallAction.DENIED, flow.resumed(false))
        assertEquals(InstallAction.NONE, flow.resumed(false))
        assertEquals(InstallAction.PERMISSION, flow.verified(true, false))
        assertEquals(InstallAction.REVERIFY, flow.resumed(true))
        assertEquals(InstallAction.NONE, flow.resumed(true))
        assertEquals(InstallAction.INSTALL, flow.verified(true, true))
        assertEquals(InstallAction.RETURNED, flow.resumed(true))
        assertEquals(InstallAction.NONE, flow.resumed(true))
    }
    @Test fun backgroundVerificationWaitsForForegroundAndReverifies() {
        val flow = AppUpdateInstallSession()
        assertEquals(InstallAction.NONE, flow.verified(false, true))
        assertEquals(InstallAction.REVERIFY, flow.resumed(true))
        assertEquals(InstallAction.INSTALL, flow.verified(true, true))
        flow.reset()
        assertEquals(InstallAction.NONE, flow.resumed(true))
    }
}
