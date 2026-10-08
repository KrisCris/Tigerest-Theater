package top.tigerest.theater

import android.content.Context

/** This preference is excluded from SettingsStore, JavaScript and bootstrap/export. */
class PrivateDanmakuConfiguration(context: Context) {
    private val prefs = context.getSharedPreferences("private-danmaku-mapping",Context.MODE_PRIVATE)
    fun credential(): String? = prefs.getString("writeToken",null)?.takeIf { SharedDanmakuMapping.validCredential(it) }
    fun setCredential(value: String) {
        val token = value.trim()
        require(token.isEmpty() || SharedDanmakuMapping.validCredential(token)) { "共享匹配令牌格式无效" }
        if (token.isEmpty()) prefs.edit().remove("writeToken").apply()
        else prefs.edit().putString("writeToken",token).apply()
    }
}
