package top.tigerest.theater
data class Pane(val left: Int,val top: Int,val right: Int,val bottom: Int)
object WindowLayout {
 fun pane(width: Int,height: Int,hinge: Pane?): Pane {
  val whole = Pane(0,0,width.coerceAtLeast(0),height.coerceAtLeast(0))
  if(hinge == null || width <= 0 || height <= 0) return whole
  val panes = if(hinge.bottom-hinge.top >= hinge.right-hinge.left)
   listOf(Pane(0,0,hinge.left.coerceIn(0,width),height),Pane(hinge.right.coerceIn(0,width),0,width,height))
  else listOf(Pane(0,0,width,hinge.top.coerceIn(0,height)),Pane(0,hinge.bottom.coerceIn(0,height),width,height))
  return panes.maxBy { (it.right-it.left).toLong()*(it.bottom-it.top) }.takeIf { it.right>it.left && it.bottom>it.top } ?: whole
 }
}
