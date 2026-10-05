package top.tigerest.theater
object SettingsPolicy {
 fun validate(section: String, key: String, value: Any, default: Any): Any {
  if (default is Boolean) require(value is Boolean) { "设置需要布尔值" }
  if (default is Number) require(value is Number && value.toDouble().isFinite()) { "设置需要有效数字" }
  if (default is String) require(value is String && value.length <= 4096) { "设置需要有效文本" }
  val range = when("$section.$key") {
   "video.cache" -> 10.0..500.0; "video.default_playback_speed" -> 0.25..4.0
   "danmaku.opacity", "danmaku.displayarea" -> 0.0..1.0; "danmaku.fontsize" -> 10.0..120.0
   "danmaku.scrolltime" -> 2.0..40.0; "danmaku.outline", "danmaku.shadow" -> 0.0..10.0
   else -> null
  }
  if (range != null) { val number = value.toString().toDoubleOrNull(); require(number != null && number in range) { "设置值超出范围" } }
  if (section == "video" && key == "hardwareDecoding") require(value in listOf("safe","enabled","copy","disabled")) { "不支持的硬解模式" }
  if (section == "main" && key == "userWebClient" && value.toString().isNotBlank()) ServerAddress.base(value.toString())
  if (section == "danmaku" && key == "apiServer" && value.toString().isNotBlank()) ServerAddress.base(value.toString())
  return value
 }
}
