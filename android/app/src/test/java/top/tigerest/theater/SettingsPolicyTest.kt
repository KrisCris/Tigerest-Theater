package top.tigerest.theater
import org.junit.Assert.*
import org.junit.Test
class SettingsPolicyTest {
 @Test fun rejectsNegativeCacheAndInvalidHardwareModes() {
  assertThrows(IllegalArgumentException::class.java) { SettingsPolicy.validate("video", "cache", -1, 75) }
  assertThrows(IllegalArgumentException::class.java) { SettingsPolicy.validate("video", "hardwareDecoding", "arbitrary", "enabled") }
  assertEquals(150, SettingsPolicy.validate("video", "cache", 150, 75))
 }
 @Test fun preservesBooleanAndBoundsOpacityWithoutCoercingStrings() {
  assertEquals(false, SettingsPolicy.validate("mpv", "enableDanmaku", false, true))
  assertThrows(IllegalArgumentException::class.java) { SettingsPolicy.validate("mpv", "enableDanmaku", "false", true) }
  assertThrows(IllegalArgumentException::class.java) { SettingsPolicy.validate("danmaku", "opacity", 1.5, 0.7) }
  assertEquals(0.4, SettingsPolicy.validate("danmaku", "opacity", 0.4, 0.7))
 }
}
