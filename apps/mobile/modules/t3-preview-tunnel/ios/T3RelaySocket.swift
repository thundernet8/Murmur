import Foundation

// 直接连接仍使用 URLSession；受保护的 relay 仅经 JavaScript 的已固定公钥通道。
final class T3RelaySocket {
  static var emit: ((String, String, String) -> Void)?
  private static let lock = NSRecursiveLock()
  private static var sockets: [String: T3RelaySocket] = [:]
  private let id = UUID().uuidString
  private let url: URL
  private let direct: URLSessionWebSocketTask?
  private var opened = false
  private var closed = false
  private var onOpen: ((Error?) -> Void)?
  private var pendingSend: [(Error?) -> Void] = []
  private var pendingReceive: ((Result<URLSessionWebSocketTask.Message, Error>) -> Void)?
  private var messages: [Data] = []
  private var bufferedBytes = 0
  private static let failure = NSError(domain: "T3EncryptedPreview", code: 1)

  init(url: URL) {
    self.url = url
    if url.fragment?.hasPrefix("relay-e2ee=") == true {
      direct = nil
    } else {
      direct = URLSession.shared.webSocketTask(with: URLRequest(url: url, timeoutInterval: 15))
      direct?.maximumMessageSize = 16 * 1024 * 1024
    }
  }

  var response: URLResponse? { direct?.response }

  func resume() {
    if let direct { return direct.resume() }
    Self.lock.lock(); defer { Self.lock.unlock() }
    Self.sockets[id] = self
    Self.emit?(id, "open", url.absoluteString)
    DispatchQueue.global().asyncAfter(deadline: .now() + 15) { [weak self] in
      Self.lock.lock(); defer { Self.lock.unlock() }
      guard let self, !self.opened else { return }
      self.cancel(with: .goingAway, reason: nil)
    }
  }

  func sendPing(pongReceiveHandler: @escaping (Error?) -> Void) {
    if let direct { return direct.sendPing(pongReceiveHandler: pongReceiveHandler) }
    Self.lock.lock(); defer { Self.lock.unlock() }
    if closed { pongReceiveHandler(Self.failure) }
    else if opened { pongReceiveHandler(nil) }
    else { onOpen = pongReceiveHandler }
  }

  func send(_ message: URLSessionWebSocketTask.Message, completionHandler: @escaping (Error?) -> Void) {
    if let direct { return direct.send(message, completionHandler: completionHandler) }
    Self.lock.lock(); defer { Self.lock.unlock() }
    guard !closed, opened else { return completionHandler(Self.failure) }
    let bytes: Data
    switch message {
    case .data(let value): bytes = value
    case .string(let value): bytes = Data(value.utf8)
    @unknown default: return completionHandler(Self.failure)
    }
    pendingSend.append(completionHandler)
    Self.emit?(id, "send", bytes.base64EncodedString())
  }

  func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
    if let direct { return direct.receive(completionHandler: completionHandler) }
    Self.lock.lock(); defer { Self.lock.unlock() }
    if !messages.isEmpty {
      let data = messages.removeFirst()
      bufferedBytes -= data.count
      completionHandler(.success(.data(data)))
    } else if closed { completionHandler(.failure(Self.failure)) }
    else { pendingReceive = completionHandler }
  }

  func cancel(with code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
    if let direct { return direct.cancel(with: code, reason: reason) }
    Self.lock.lock(); defer { Self.lock.unlock() }
    guard !closed else { return }
    closed = true
    Self.sockets.removeValue(forKey: id)
    Self.emit?(id, "close", "")
    let onOpen = self.onOpen; self.onOpen = nil
    let pending = pendingSend; pendingSend.removeAll()
    let receive = pendingReceive; pendingReceive = nil
    onOpen?(Self.failure)
    pending.forEach { $0(Self.failure) }
    receive?(.failure(Self.failure))
  }

  static func receive(id: String, type: String, data: String) {
    lock.lock(); defer { lock.unlock() }
    guard let socket = sockets[id], !socket.closed else { return }
    switch type {
    case "open":
      socket.opened = true
      let callback = socket.onOpen; socket.onOpen = nil
      callback?(nil)
    case "sent":
      if !socket.pendingSend.isEmpty { socket.pendingSend.removeFirst()(nil) }
    case "message":
      guard let bytes = Data(base64Encoded: data) else {
        return socket.cancel(with: .invalid, reason: nil)
      }
      if let receive = socket.pendingReceive {
        socket.pendingReceive = nil
        receive(.success(.data(bytes)))
      } else {
        socket.bufferedBytes += bytes.count
        if socket.bufferedBytes > 16 * 1024 * 1024 { return socket.cancel(with: .messageTooBig, reason: nil) }
        socket.messages.append(bytes)
      }
    default: socket.cancel(with: .goingAway, reason: nil)
    }
  }

  static func shutdown() {
    lock.lock(); defer { lock.unlock() }
    Array(sockets.values).forEach { $0.cancel(with: .goingAway, reason: nil) }
    emit = nil
  }
}
