package top.tigerest.theater

import okhttp3.Response
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InterruptedIOException

/** A complete partial is verified by the engine without another network request. */
fun resumeOffset(destination: File, candidate: AppUpdateCandidate): Long =
    destination.length().takeIf { destination.isFile && it in 1..candidate.size } ?: 0L

/** Only an exact suffix response may append to the SHA-keyed prefix. */
fun writePackage(response: Response, candidate: AppUpdateCandidate, destination: File, offset: Long,
    cancelled: () -> Boolean, progress: (Long) -> Unit) {
    if (cancelled()) throw InterruptedIOException("cancelled")
    val append = response.code == 206
    if (response.code == 416 || append && (offset !in 1 until candidate.size ||
            response.header("Content-Range") != "bytes $offset-${candidate.size - 1}/${candidate.size}")) {
        FileOutputStream(destination).use { it.fd.sync() }
        progress(0)
        throw IOException("更新包续传位置不匹配，将重新下载")
    }
    check(response.code == 200 || append) { "更新服务未返回完整更新包" }
    val start = if (append) offset else 0L
    val body = response.body ?: throw IllegalStateException("更新包为空")
    require(body.contentLength() == -1L || body.contentLength() == candidate.size - start) { "更新包大小不匹配，请重新检查更新" }
    if (append) check(destination.isFile && destination.length() == offset) { "更新包续传位置已经改变，请重试" }
    if (cancelled()) throw InterruptedIOException("cancelled")
    body.byteStream().use { input -> FileOutputStream(destination, append).use { output ->
        val bytes = ByteArray(64 * 1024)
        var received = start
        var reportedAt = 0L
        progress(received)
        try {
            while (true) {
                if (cancelled()) throw InterruptedIOException("cancelled")
                val count = input.read(bytes)
                if (count < 0) break
                if (cancelled()) throw InterruptedIOException("cancelled")
                require(count.toLong() <= candidate.size - received) { "更新包超出预期大小" }
                output.write(bytes, 0, count)
                received += count
                val now = System.nanoTime()
                if (now - reportedAt >= 200_000_000L || received == candidate.size) {
                    reportedAt = now; progress(received)
                }
            }
            if (received < candidate.size) throw IOException("更新包下载中断")
        } finally {
            output.fd.sync()
            // A final report also covers a short body or a failure between throttled updates.
            progress(received)
        }
    } }
}
