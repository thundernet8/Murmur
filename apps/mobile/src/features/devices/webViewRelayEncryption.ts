import type { DeviceHubAccess } from "@t3tools/client-runtime/device/hub-access";
import { createRelayTransport } from "@t3tools/shared/relayTransport";

let transport: ReturnType<typeof createRelayTransport> | undefined;

export function configureWebViewRelayEncryption(access: DeviceHubAccess) {
  if (!access.relayPublicKey) return;
  // WebView 与 React Native 不共享全局对象，公钥由已完成配对的原生客户端传入。
  transport ??= createRelayTransport({
    fetch: globalThis.fetch.bind(globalThis),
    WebSocket: globalThis.WebSocket,
  });
  transport.pin(access.httpBase, access.relayPublicKey);
  globalThis.fetch = transport.fetch;
  globalThis.WebSocket = transport.WebSocket;
}
