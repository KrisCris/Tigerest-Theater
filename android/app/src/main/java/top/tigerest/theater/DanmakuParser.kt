package top.tigerest.theater

import org.json.JSONArray
import org.json.JSONObject
import org.xml.sax.InputSource
import java.io.StringReader
import javax.xml.parsers.DocumentBuilderFactory

/** Dandanplay JSON, Bilibili XML and ASS imports share one validated timeline. */
object DanmakuParser {
    fun parse(text: String): List<DanmakuComment> {
        require(text.length <= 16 * 1024 * 1024) { "弹幕文件过大" }
        val value = text.trimStart('\uFEFF', ' ', '\n', '\r', '\t')
        val comments = when {
            value.startsWith("{") || Regex("^\\[\\s*(\\{|\\])").containsMatchIn(value) -> json(value)
            value.startsWith("<") -> xml(value)
            else -> ass(value)
        }
        return comments.filter { it.time.isFinite() && it.time >= 0 && it.text.isNotBlank() }
            .take(50_000).sortedBy { it.time }
    }
    private fun comment(time: Double, text: String, mode: Int, color: Int) =
        DanmakuComment(time, text.replace(Regex("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]"), "").take(500),
            if (mode in listOf(4, 5)) mode else 1, color and 0xffffff)
    private fun json(text: String): List<DanmakuComment> {
        val values = if (text.startsWith("[")) JSONArray(text) else JSONObject(text).optJSONArray("comments") ?: JSONArray()
        return (0 until minOf(values.length(), 50_000)).mapNotNull { index ->
            val item = values.optJSONObject(index) ?: return@mapNotNull null
            val fields = item.optString("p").split(',')
            val time = fields.getOrNull(0)?.toDoubleOrNull() ?: return@mapNotNull null
            val shift = item.optDouble("shift", 0.0)
            comment(time + shift, item.optString("m", item.optString("text")),
                fields.getOrNull(1)?.toIntOrNull() ?: 1, fields.getOrNull(2)?.toIntOrNull() ?: 0xffffff)
        }
    }
    private fun xml(text: String): List<DanmakuComment> {
        require(!Regex("<!\\s*(DOCTYPE|ENTITY)", RegexOption.IGNORE_CASE).containsMatchIn(text)) { "弹幕 XML 不允许外部实体" }
        val factory = DocumentBuilderFactory.newInstance().apply {
            isNamespaceAware = false; isExpandEntityReferences = false
            // Android libcore does not implement these optional JAXP features.
            // DOCTYPE/ENTITY rejection above and the resolver below remain mandatory.
            runCatching { setFeature("http://xml.org/sax/features/external-general-entities", false) }
            runCatching { setFeature("http://xml.org/sax/features/external-parameter-entities", false) }
        }
        val builder = factory.newDocumentBuilder()
        builder.setEntityResolver { _,_ -> throw org.xml.sax.SAXException("External entities are forbidden") }
        val document = builder.parse(InputSource(StringReader(text)))
        val nodes = document.getElementsByTagName("d")
        return (0 until minOf(nodes.length, 50_000)).mapNotNull { index ->
            val node = nodes.item(index)
            val fields = (node.attributes.getNamedItem("p")?.nodeValue ?: "").split(',')
            val time = fields.getOrNull(0)?.toDoubleOrNull() ?: return@mapNotNull null
            comment(time, node.textContent, fields.getOrNull(1)?.toIntOrNull() ?: 1, fields.getOrNull(3)?.toIntOrNull() ?: 0xffffff)
        }
    }
    private fun ass(text: String): List<DanmakuComment> {
        var format = listOf("layer", "start", "end", "style", "name", "marginl", "marginr", "marginv", "effect", "text")
        var events = false
        var styles = false
        var styleFormat = emptyList<String>()
        val styleValues = HashMap<String,Pair<Int,Int>>()
        val result = ArrayList<DanmakuComment>()
        text.lineSequence().forEach { raw ->
            val line = raw.trim()
            if (line.startsWith("[")) { events = line.equals("[Events]", true); styles = line.equals("[V4+ Styles]",true) }
            if(styles) {
                if(line.startsWith("Format:",true)) styleFormat = line.substringAfter(':').split(',').map { it.trim().lowercase() }
                if(line.startsWith("Style:",true)) {
                    val values = line.substringAfter(':').split(',').map { it.trim() }
                    val name = values.getOrNull(styleFormat.indexOf("name"))
                    val align = values.getOrNull(styleFormat.indexOf("alignment"))?.toIntOrNull() ?: 2
                    val bgr = values.getOrNull(styleFormat.indexOf("primarycolour"))?.removePrefix("&H")?.removeSuffix("&")?.toLongOrNull(16)?.toInt() ?: 0xffffff
                    if(name != null) styleValues[name] = align to bgr
                }
            }
            if (!events || result.size >= 50_000) return@forEach
            if (line.startsWith("Format:", true)) format = line.substringAfter(':').split(',').map { it.trim().lowercase() }
            if (!line.startsWith("Dialogue:", true)) return@forEach
            val fields = line.substringAfter(':').trimStart().split(',', limit = format.size)
            val start = fields.getOrNull(format.indexOf("start")) ?: return@forEach
            val parts = start.split(':')
            if (parts.size != 3) return@forEach
            val time = (parts[0].toDoubleOrNull() ?: return@forEach) * 3600 +
                (parts[1].toDoubleOrNull() ?: return@forEach) * 60 + (parts[2].toDoubleOrNull() ?: return@forEach)
            val content = fields.getOrNull(format.indexOf("text")) ?: return@forEach
            val style = styleValues[fields.getOrNull(format.indexOf("style"))]
            val alignment = Regex("\\\\an([1-9])").find(content)?.groupValues?.get(1)?.toIntOrNull() ?: style?.first
            val color = Regex("\\\\(?:1c|c)&H([0-9A-Fa-f]{6})&").find(content)?.groupValues?.get(1)?.toIntOrNull(16) ?: style?.second
            val rgb = color?.let { ((it and 0xff) shl 16) or (it and 0xff00) or ((it shr 16) and 0xff) } ?: 0xffffff
            val clean = content.replace(Regex("\\{[^}]*}"), "").replace("\\N", "\n").replace("\\n", "\n").replace("\\h", " ")
            val moving = content.contains("\\move(",true)
            result.add(comment(time, clean, if(moving) 1 else when (alignment) { 7, 8, 9 -> 5; 1, 2, 3 -> 4; else -> 1 }, rgb))
        }
        return result
    }
}
