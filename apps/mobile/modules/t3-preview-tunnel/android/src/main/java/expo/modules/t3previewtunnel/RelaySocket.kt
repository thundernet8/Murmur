package expo.modules.t3previewtunnel

import android.util.Base64
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

// 加密连接经 JavaScript 复用已固定的主机身份；这里不实现另一套密码协议。
internal class RelaySocket(
  private val original: Request,
  private val listener: WebSocketListener
) : WebSocket {
  private val id = UUID.randomUUID().toString()
  private val queued = AtomicLong()
  private val receiving = AtomicLong()
  private val worker = Executors.newSingleThreadExecutor()
  @Volatile private var closed = false

  fun start(): WebSocket {
    sockets[id] = this
    emit?.invoke(id, "open", original.url.toString())
    return this
  }

  override fun request() = original
  override fun queueSize() = queued.get()
  override fun send(text: String) = send(text.toByteArray().toByteString())
  override fun send(bytes: ByteString): Boolean {
    if (closed) return false
    queued.addAndGet(bytes.size.toLong())
    emit?.invoke(id, "send", bytes.base64())
    return true
  }
  override fun close(code: Int, reason: String?): Boolean {
    cancel()
    return true
  }
  override fun cancel() {
    if (closed) return
    closed = true
    sockets.remove(id)
    emit?.invoke(id, "close", "")
    worker.shutdownNow()
    listener.onFailure(this, IOException("Encrypted preview channel closed"), null)
  }

  private fun receive(type: String, data: String) {
    if (closed) return
    val size = data.length.toLong()
    if (receiving.addAndGet(size) > 24 * 1024 * 1024) { cancel(); return }
    runCatching {
      worker.execute {
        try {
          if (!closed) when (type) {
            "open" -> listener.onOpen(this, Response.Builder().request(original)
              .protocol(Protocol.HTTP_1_1).code(101).message("Encrypted tunnel").build())
            "sent" -> queued.addAndGet(-(data.toLongOrNull() ?: 0))
            "message" -> listener.onMessage(this, Base64.decode(data, Base64.NO_WRAP).toByteString())
            else -> cancel()
          }
        } catch (_: Exception) { cancel() }
        finally { receiving.addAndGet(-size) }
      }
    }.onFailure { cancel() }
  }

  companion object {
    var emit: ((String, String, String) -> Unit)? = null
    private val sockets = ConcurrentHashMap<String, RelaySocket>()
    fun receive(id: String, type: String, data: String) { sockets[id]?.receive(type, data) }
    fun shutdown() { sockets.values.toList().forEach { it.cancel() }; emit = null }
  }
}
