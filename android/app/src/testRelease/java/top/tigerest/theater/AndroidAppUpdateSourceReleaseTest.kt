package top.tigerest.theater

import android.content.ContextWrapper
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class AndroidAppUpdateSourceReleaseTest {
    @Test fun releaseRejectsDebugUpdateSource() {
        assertFalse(BuildConfig.DEBUG)
        val source = AndroidAppUpdateSource(ContextWrapper(null))
        assertThrows(IllegalStateException::class.java) {
            source.debugFixture("http://127.0.0.1:12345")
        }
    }
}
