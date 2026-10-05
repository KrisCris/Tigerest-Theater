package top.tigerest.theater
import org.junit.Assert.*
import org.junit.Test
class DanmakuParserTest {
 @Test fun assMotionOverridesAlignmentAndStyleDefinesFixedPosition() {
  val ass = """[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Alignment
Style: TOP,Arial,25,&H0000FF00,8
Style: BTM,Arial,25,&H00FFFFFF,2
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:06.00,TOP,,0,0,0,,{\an7\move(1920,50,-500,50)}scroll
Dialogue: 0,0:00:02.00,0:00:07.00,TOP,,0,0,0,,{\pos(960,50)}fixed-top
Dialogue: 0,0:00:03.00,0:00:08.00,BTM,,0,0,0,,{\pos(960,1000)}fixed-bottom"""
  val comments = DanmakuParser.parse(ass)
  assertEquals(listOf(1,5,4),comments.map { it.mode }); assertEquals(0x00ff00,comments[1].color)
 }
 @Test fun dandanPlayShiftAndXmlColorUseTheirDifferentFieldPositions() {
  val json = DanmakuParser.parse("""{"comments":[{"p":"1.5,5,16711680,user","m":"中文弹幕","shift":2}]}""")
  assertEquals(3.5,json.single().time,0.0001); assertEquals(5,json.single().mode); assertEquals(0xff0000,json.single().color)
  val xml = DanmakuParser.parse("""<i><d p="2,1,25,65280,0">你好 &amp; 世界</d></i>""")
  assertEquals("你好 & 世界",xml.single().text); assertEquals(0x00ff00,xml.single().color)
 }
 @Test fun assTagsAreNotDisplayedAndXmlExternalEntitiesAreRejected() {
  val ass = DanmakuParser.parse("[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:03.50,0:00:08.50,Default,,0,0,0,,{\\an8}顶部,文字")
  assertEquals(3.5,ass.single().time,0.0001); assertEquals("顶部,文字",ass.single().text); assertEquals(5,ass.single().mode)
  assertThrows(IllegalArgumentException::class.java) { DanmakuParser.parse("<!DOCTYPE i [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><i>&x;</i>") }
 }
}
