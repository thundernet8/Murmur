/// <reference lib="dom" />
import type { createRelayTransport } from "./relayTransport.ts";

export interface RelaySocketBridgeEvent {
  readonly id: string;
  readonly type: string;
  readonly data: string;
}

// 原生 SOCKS 只搬运字节；握手与密钥留在已有的 JavaScript 加密适配层。
export function createRelaySocketBridge(input: {
  transport: () => ReturnType<typeof createRelayTransport> | undefined;
  receive: (id: string, type: string, data: string) => void;
}) {
  const sockets = new Map<string, WebSocket>();
  const close = (id: string) => {
    const socket = sockets.get(id);
    sockets.delete(id);
    socket?.close();
    input.receive(id, "close", "");
  };
  return (event: RelaySocketBridgeEvent) => {
    const { id, type, data } = event;
    try {
      if (type === "open") {
        if (sockets.has(id)) return close(id);
        const transport = input.transport();
        const url = new URL(data);
        const publicKey = url.hash.slice("#relay-e2ee=".length);
        if (
          !url.hash.startsWith("#relay-e2ee=") ||
          !transport?.isEncrypted(url.href) ||
          transport.publicKey(url.href) !== publicKey
        )
          throw new Error("Missing trusted relay identity");
        url.hash = "";
        const socket = new transport.WebSocket(url);
        sockets.set(id, socket);
        socket.binaryType = "arraybuffer";
        socket.onopen = () => input.receive(id, "open", "");
        socket.onmessage = (message) => {
          const bytes =
            typeof message.data === "string"
              ? new TextEncoder().encode(message.data)
              : new Uint8Array(message.data);
          let text = "";
          for (let offset = 0; offset < bytes.length; offset += 8192)
            text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
          input.receive(id, "message", btoa(text));
        };
        socket.onclose = () => {
          if (sockets.get(id) === socket) close(id);
        };
        socket.onerror = () => close(id);
      } else if (type === "send") {
        const socket = sockets.get(id);
        if (!socket || socket.readyState !== 1) throw new Error("Preview channel is not ready");
        socket.send(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)));
        input.receive(id, "sent", String(atob(data).length));
      } else if (type === "close") close(id);
      else throw new Error("Invalid preview bridge event");
    } catch {
      close(id);
    }
  };
}
