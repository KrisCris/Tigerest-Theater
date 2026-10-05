package top.tigerest.theater
import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
class MpvSurface(context: Context,private val player: PlaybackController): SurfaceView(context),SurfaceHolder.Callback {
 init { holder.addCallback(this) }
 override fun surfaceCreated(holder: SurfaceHolder) { player.attach(holder.surface) }
 override fun surfaceChanged(holder: SurfaceHolder,format: Int,width: Int,height: Int) { player.surfaceSize(width,height) }
 override fun surfaceDestroyed(holder: SurfaceHolder) { player.detach() }
}
