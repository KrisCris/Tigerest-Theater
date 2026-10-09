package top.tigerest.theater
import android.app.Application
import androidx.lifecycle.AndroidViewModel
class ClientModel(application: Application): AndroidViewModel(application) {
    val settings = SettingsStore(application)
    val player = PlaybackController(application,settings)
    val danmaku = DanmakuRepository(application,settings)
    val updates = AppUpdateController(application,settings)
    val rotation = SystemRotationPolicy()
    var playbackTouchLocked = false
    override fun onCleared() { updates.close(); danmaku.close(); player.destroy() }
}
