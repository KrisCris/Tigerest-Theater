package top.tigerest.theater

import org.json.JSONObject
import java.time.Instant
import java.util.ArrayDeque

object ReportLogSanitizer {
    const val MAX_RECORD_CHARS = 65536
    private const val REDACTED = "[redacted private diagnostic record]"
    private val privateField = Regex("""(?i)(?:^|[^a-z0-9])(?:access[-_]?token|refresh[-_]?token|api[-_]?key|token|password(?:hash)?|passwd|pwd|secret|signature|sig|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|x[-_](?:emby|mediabrowser)[-_](?:token|authorization|user[-_]?id|server[-_]?id)|(?:emby[-_]?)?user[-_]?(?:id|name)|username|account(?:[-_]?(?:id|name))?|user|author|email|device[-_]?id|(?:emby[-_]?)?server[-_]?id|session[-_]?id|credential)[\s"'\\]*[:=]""")
    private val authScheme = Regex("""(?i)(?:^|[\s"'])\b(?:bearer|basic)\s+\S+""")
    private val url = Regex("""(?i)(?:https?|file|content)://[^\s<>"']+""")
    private val absolutePath = Regex("""(?:[a-zA-Z]:[\\/]|(?:^|[\s"'=(:\[{])(?:\\\\|/[^\s/]))""")

    private fun validText(input: String): String {
        val out = StringBuilder(input.length)
        var index = 0
        while(index < input.length) {
            val char = input[index++]
            when {
                char.isHighSurrogate() -> if(index < input.length && input[index].isLowSurrogate()) { out.append(char); out.append(input[index++]) } else out.append('\uFFFD')
                char.isLowSurrogate() -> out.append('\uFFFD')
                char.code < 32 && char != '\n' && char != '\r' && char != '\t' || char.code in 127..159 -> out.append(' ')
                else -> out.append(char)
            }
        }
        return out.toString()
    }
    private fun decodeDetection(input: String): String {
        val out = StringBuilder(input.length)
        var index = 0
        while(index < input.length) {
            if(input[index] == '%' && index + 2 < input.length) {
                val first = input[index+1].digitToIntOrNull(16)
                val second = input[index+2].digitToIntOrNull(16)
                if(first != null && second != null) { out.append((first*16+second).toChar()); index += 3; continue }
            }
            out.append(input[index++])
        }
        return out.toString()
    }
    private fun decodeJsonEscapes(input: String): String {
        val out = StringBuilder(input.length)
        var index = 0
        while(index < input.length) {
            if(input[index] == '\\' && index + 5 < input.length && input[index+1] == 'u') {
                val value = input.substring(index+2,index+6).toIntOrNull(16)
                if(value != null) { out.append(value.toChar()); index += 6; continue }
            }
            out.append(input[index++])
        }
        return out.toString()
    }
    private fun hasPrivateAt(input: String): Boolean {
        // Linear even for a long malformed address or a private local domain.
        for(index in 1 until input.lastIndex)
            if(input[index] == '@' && !input[index-1].isWhitespace() && !input[index+1].isWhitespace()) return true
        return false
    }
    fun sanitize(record: String): String {
        if(record.length > MAX_RECORD_CHARS) return REDACTED
        val text = validText(record)
        val inspect = decodeJsonEscapes(decodeDetection(decodeDetection(text))).replace("\\\"","\"").replace("\\/","/")
        // Reject the entire actual app record on ambiguous JSON, escaped or
        // multiline credentials. No substring after an escaped quote survives.
        if(privateField.containsMatchIn(inspect) || authScheme.containsMatchIn(inspect) || hasPrivateAt(inspect)) return REDACTED
        if(inspect != text && url.containsMatchIn(inspect)) return REDACTED
        val withoutUrls = url.replace(inspect,"[redacted URL]")
        if(absolutePath.containsMatchIn(withoutUrls)) return REDACTED
        return url.replace(text,"[redacted URL]")
    }
}

class DiagnosticsLog(private val clock: () -> Long = System::currentTimeMillis) {
    private data class Record(val time: Long, val text: String, val bytes: Int)
    private val records = ArrayDeque<Record>()
    private var scope = ""
    private var bytes = 0
    private var truncated = false
    @Synchronized fun setScope(key: String) {
        val next = key.takeIf { it.length <= 256 } ?: ""
        if(next == scope) return
        // Opaque account session key exists only in memory. Never persist it or
        // import a previous process's unscoped crash/log tail.
        scope = next; records.clear(); bytes = 0; truncated = false
    }
    @Synchronized fun record(level: String, message: String) {
        if(scope.isEmpty()) return
        val time = clock()
        prune(time)
        val safeLevel = level.takeIf { it in setOf("debug","info","warning","error","fatal") } ?: "info"
        val clean = ReportLogSanitizer.sanitize(message)
        if(message.length > ReportLogSanitizer.MAX_RECORD_CHARS) truncated = true
        val text = "${Instant.ofEpochMilli(time)} [$safeLevel] Android - $clean\n"
        val size = text.toByteArray(Charsets.UTF_8).size
        records.addLast(Record(time,text,size)); bytes += size
        while(bytes > MAX_BYTES || records.size > MAX_RECORDS) { bytes -= records.removeFirst().bytes; truncated = true }
    }
    private fun prune(now: Long) {
        while(records.isNotEmpty() && records.first.time < now - WINDOW_MILLIS) bytes -= records.removeFirst().bytes
    }
    @Synchronized fun collect(): JSONObject {
        if(scope.isEmpty()) return JSONObject()
        val now = clock(); prune(now)
        // Future records after a clock adjustment do not enter the snapshot.
        val current = records.filter { it.time in (now-WINDOW_MILLIS)..now }
        if(current.isEmpty()) return JSONObject()
        return JSONObject().put("capturedAt",Instant.ofEpochMilli(now).toString())
            .put("truncated",truncated).put("logText",current.joinToString("") { it.text })
    }
    companion object {
        const val MAX_BYTES = 1048576
        private const val MAX_RECORDS = 2048
        private const val WINDOW_MILLIS = 600000L
        val app = DiagnosticsLog()
    }
}
