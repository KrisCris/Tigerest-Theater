package top.tigerest.theater

import android.content.pm.ActivityInfo
import org.junit.Assert.*
import org.junit.Test

class SystemRotationPolicyTest {
    @Test fun systemLockKeepsLastLandscapeEvenWhenDeviceAlreadyReportedPortrait() {
        val policy = SystemRotationPolicy()
        policy.update(true, ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE,
            policy.update(false, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_REVERSE_LANDSCAPE,
            policy.update(false, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT))
    }
    @Test fun reenablingSystemRotationReleasesLockAndAllowsANewDirection() {
        val policy = SystemRotationPolicy()
        policy.update(true, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE)
        policy.update(false, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT)
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED,
            policy.update(true, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT))
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,
            policy.update(false, ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE))
    }
    @Test fun startupWithSystemLockAlreadyOnRespectsTheSystemDirection() {
        val policy = SystemRotationPolicy()
        assertEquals(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED,
            policy.update(false, ActivityInfo.SCREEN_ORIENTATION_PORTRAIT))
    }
}
