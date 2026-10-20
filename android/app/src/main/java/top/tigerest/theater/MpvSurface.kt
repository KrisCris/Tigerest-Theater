package top.tigerest.theater
import android.content.Context
import android.view.SurfaceHolder
import android.view.SurfaceView
class MpvSurface(context: Context,private val player: PlaybackController): SurfaceView(context),SurfaceHolder.Callback {
 init { holder.addCallback(this) }
 /** MediaCodec output fills the whole surface, so HDR output sizes the view to the video; 0 fills the pane for mpv. */
 var aspect = 0.0
  set(value) { if(field != value) { field = value; requestLayout() } }
 override fun onMeasure(widthMeasureSpec: Int,heightMeasureSpec: Int) {
  super.onMeasure(widthMeasureSpec,heightMeasureSpec)
  if(aspect > 0) { val fit = PlaybackContract.fit(measuredWidth,measuredHeight,aspect); setMeasuredDimension(fit.width,fit.height) }
 }
 override fun surfaceCreated(holder: SurfaceHolder) { player.attach(holder.surface) }
 override fun surfaceChanged(holder: SurfaceHolder,format: Int,width: Int,height: Int) { player.surfaceSize(width,height) }
 override fun surfaceDestroyed(holder: SurfaceHolder) { player.detach() }
}
