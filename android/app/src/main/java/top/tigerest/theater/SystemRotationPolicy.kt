package top.tigerest.theater

import android.content.pm.ActivityInfo

/** Captures the direction before OEM rotation-off policies jump back to portrait. */
class SystemRotationPolicy {
    private var autoRotate: Boolean? = null
    private var lastAutomaticDirection = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    private var lockedDirection = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED

    fun update(automatic: Boolean, currentDirection: Int): Int {
        if(automatic) {
            lastAutomaticDirection = currentDirection
            lockedDirection = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        } else if(autoRotate == true) {
            lockedDirection = lastAutomaticDirection
        }
        autoRotate = automatic
        return lockedDirection
    }
}
