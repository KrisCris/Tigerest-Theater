package top.tigerest.theater
data class Pane(val left: Int,val top: Int,val right: Int,val bottom: Int)
data class EdgeInsets(val left: Int=0,val top: Int=0,val right: Int=0,val bottom: Int=0)
object WindowLayout {
 fun safeContent(pane: Pane,width: Int,height: Int,insets: EdgeInsets): Pane = Pane(
  maxOf(pane.left,insets.left).coerceAtMost(pane.right),maxOf(pane.top,insets.top).coerceAtMost(pane.bottom),
  minOf(pane.right,width-insets.right).coerceAtLeast(pane.left),minOf(pane.bottom,height-insets.bottom).coerceAtLeast(pane.top))
 fun pane(width: Int,height: Int,hinge: Pane?): Pane {
  val whole = Pane(0,0,width.coerceAtLeast(0),height.coerceAtLeast(0))
  if(hinge == null || width <= 0 || height <= 0) return whole
  val panes = if(hinge.bottom-hinge.top >= hinge.right-hinge.left)
   listOf(Pane(0,0,hinge.left.coerceIn(0,width),height),Pane(hinge.right.coerceIn(0,width),0,width,height))
  else listOf(Pane(0,0,width,hinge.top.coerceIn(0,height)),Pane(0,hinge.bottom.coerceIn(0,height),width,height))
  return panes.maxBy { (it.right-it.left).toLong()*(it.bottom-it.top) }.takeIf { it.right>it.left && it.bottom>it.top } ?: whole
 }
}
