package top.tigerest.theater

import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONArray

class AndroidIntegrationTest {
 @Test fun slowLocalImportCannotAttachToAnotherEpisode() {
  val context = InstrumentationRegistry.getInstrumentation().targetContext
  val settings = SettingsStore(context); val original = settings.get("mpv","enableDanmaku")
  val repository = DanmakuRepository(context,settings)
  try {
   settings.set("mpv","enableDanmaku",false)
   repository.autoMatch(org.json.JSONObject().put("Id","local-import-old")); val token = repository.currentToken()
   repository.autoMatch(org.json.JSONObject().put("Id","local-import-new"))
   repository.importText("local-fixture","旧集慢文档","<i><d p=\"1,1,25,16777215\">旧弹幕</d></i>",token)
   assertTrue(repository.sources.isEmpty())
  } finally { repository.close(); settings.set("mpv","enableDanmaku",original) }
 }
 @Test fun xmlParserWorksWithAndroidLibcoreAndRejectsEntities() {
  val records = DanmakuParser.parse("<i><d p=\"1.5,5,25,16711680\">安卓 &amp; XML</d></i>")
  assertEquals("安卓 & XML",records.single().text); assertEquals(5,records.single().mode)
  assertThrows(IllegalArgumentException::class.java) { DanmakuParser.parse("<!DOCTYPE i [<!ENTITY x SYSTEM 'file:///sdcard/private'>]><i>&x;</i>") }
 }
 @Test fun persistedSettingsResetAndUnsupportedSettingsUseActualAndroidStorage() {
  val context = InstrumentationRegistry.getInstrumentation().targetContext
  val prefs = context.getSharedPreferences("client-settings",0)
  val original = prefs.getString("values",null)
  try {
   val settings = SettingsStore(context)
   settings.set("danmaku","opacity",0.5)
   assertEquals(0.5,SettingsStore(context).number("danmaku","opacity"),0.0001)
   settings.reset("danmaku"); assertEquals(0.7,settings.number("danmaku","opacity"),0.0001)
   assertThrows(IllegalArgumentException::class.java) { settings.set("video","aiRife",true) }
  } finally { val editor = prefs.edit(); if(original == null) editor.remove("values") else editor.putString("values",original); editor.commit() }
 }
 @Test fun packagedMpvLoadsWithoutAnExternalPlayerApplication() {
  val context = InstrumentationRegistry.getInstrumentation().targetContext
  val player = PlaybackController(context,SettingsStore(context))
  try { val info = player.dispatch("mpvDiagnostics",JSONArray()) as org.json.JSONObject; assertTrue(info.getString("version").contains("mpv")) }
  finally { player.destroy() }
 }
}
