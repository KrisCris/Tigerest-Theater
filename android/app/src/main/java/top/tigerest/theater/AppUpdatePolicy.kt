package top.tigerest.theater

import org.json.JSONArray
import java.io.File
import java.math.BigInteger
import java.security.MessageDigest

data class AppUpdateCandidate(val version: String, val releaseUrl: String, val notes: String, val size: Long, val sha256: String, val downloadUrl: String)
data class ApkIdentity(val packageName: String, val versionCode: Long, val versionName: String, val signers: Set<String>)

object AppUpdatePolicy {
    private const val REPOSITORY = "https://github.com/Tigerest/Tigerest-Theater"
    private val stableVersion = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    private fun numbers(version: String) = version.split('.').map { BigInteger(it) }
    private fun compare(a: String, b: String): Int {
        val left = numbers(a); val right = numbers(b)
        return left.indices.map { left[it].compareTo(right[it]) }.firstOrNull { it != 0 } ?: 0
    }
    fun select(releases: JSONArray, currentVersion: String): AppUpdateCandidate? {
        val current = currentVersion.removePrefix("v").substringBefore('-').substringBefore('+')
        require(stableVersion.matches(current)) { "当前版本号无效" }
        var best: AppUpdateCandidate? = null
        for (i in 0 until releases.length()) {
            val release = releases.optJSONObject(i) ?: continue
            if (release.opt("draft") != false || release.opt("prerelease") != false) continue
            val tag = release.optString("tag_name")
            if (!tag.startsWith('v')) continue
            val version = tag.substring(1)
            if (!stableVersion.matches(version)) continue
            val order = compare(version, current)
            if (order < 0 || (order == 0 && !currentVersion.substringBefore('+').contains('-'))) continue
            val releaseUrl = "$REPOSITORY/releases/tag/$tag"
            if (release.optString("html_url") != releaseUrl) continue
            val name = "TigerestTheater-$version-android.apk"
            val downloadUrl = "$REPOSITORY/releases/download/$tag/$name"
            val assets = release.optJSONArray("assets") ?: continue
            val matching = (0 until assets.length()).mapNotNull { assets.optJSONObject(it) }.filter { it.optString("name") == name }
            if (matching.size != 1) continue
            val asset = matching.single()
            val sizeText = asset.opt("size")?.toString() ?: continue
            val size = sizeText.toLongOrNull() ?: continue
            val hash = asset.optString("digest")
            if (asset.optString("state") != "uploaded" || size !in 1..(1024L * 1024 * 1024) || !Regex("sha256:[0-9a-fA-F]{64}").matches(hash) || asset.optString("browser_download_url") != downloadUrl) continue
            val notes = release.optString("body").take(16000).replace(Regex("<[^>]*>"), "").replace(Regex("[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]"), "")
            if (best == null || compare(version, best.version) > 0) best = AppUpdateCandidate(version, releaseUrl, notes, size, hash.substring(7).lowercase(), downloadUrl)
        }
        return best
    }
    fun verifyFile(file: File, candidate: AppUpdateCandidate) {
        require(file.isFile && file.length() == candidate.size) { "更新包大小不匹配，请重新下载" }
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buffer = ByteArray(64 * 1024); while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) } }
        val actual = digest.digest().joinToString("") { "%02x".format(it) }
        require(actual == candidate.sha256) { "更新包 SHA-256 校验失败，请重新下载" }
    }
    fun verifyApk(update: ApkIdentity, installed: ApkIdentity, version: String, apkAbis: Set<String>, deviceAbis: List<String>) {
        require(update.packageName == installed.packageName) { "更新包应用标识不匹配" }
        require(update.versionCode > installed.versionCode && update.versionName == version) { "更新包版本不匹配或不高于当前版本" }
        require(update.signers.isNotEmpty() && update.signers == installed.signers) { "更新包签名与当前应用不一致" }
        require(deviceAbis.any { it in apkAbis }) { "更新包不支持此设备的处理器架构" }
    }
}
