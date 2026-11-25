import * as NativeFetch from "whatwg-fetch";
// @effect-diagnostics nodeBuiltinImport:off globalFetch:off -- 此 E2E 测试验证真实 Node HTTP/WebSocket 与 fetch 边界。
import * as NodeHttp from "node:http";
import * as NodeFSP from "node:fs/promises";
import { WebSocket, WebSocketServer } from "ws";
import { expect, it } from "vite-plus/test";
import { generateNoiseKeyPair } from "@murmur/shared/relayE2ee/noise";
import { createRelaySocketBridge } from "@murmur/shared/relaySocketBridge";
import { createRelayTransport } from "@murmur/shared/relayTransport";
import { startEncryptedRelayGateway } from "../src/relay/EncryptedRelayGateway.ts";

it("通过真实密文入口传输认证、流式 HTTP 和二进制 WebSocket，并拒绝明文与错误身份", async () => {
  const requests: string[] = [];
  const origin = NodeHttp.createServer(async (req, res) => {
    requests.push(req.url ?? "");
    if (req.headers.authorization !== "Bearer endpoint-secret") {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    res.writeHead(201, { "content-type": "application/octet-stream", "x-result": "encrypted" });
    res.end(Buffer.concat(chunks));
  });
  const upstreamWs = new WebSocketServer({ server: origin });
  upstreamWs.on("connection", (socket) =>
    socket.on("message", (data, binary) => socket.send(data, { binary })),
  );
  await new Promise<void>((resolve, reject) => {
    origin.once("error", reject);
    origin.listen(0, "127.0.0.1", () => {
      origin.off("error", reject);
      resolve();
    });
  });
  const address = origin.address();
  if (!address || typeof address === "string") throw new Error("missing port");
  const identity = generateNoiseKeyPair();
  const gateway = await startEncryptedRelayGateway({
    origin: `http://127.0.0.1:${address.port}`,
    keyPair: identity,
  });
  const publicOrigin = gateway.origin;
  let ciphertextFrames = 0;
  let plaintextObserved = false;
  class ObservedSocket extends WebSocket {
    override send(data: Parameters<WebSocket["send"]>[0]) {
      const wire = Buffer.from(
        data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array),
      );
      ciphertextFrames++;
      plaintextObserved ||= ["endpoint-secret", "secret-ticket", "secret-file"].some((secret) =>
        wire.includes(secret),
      );
      return super.send(data);
    }
  }
  const transport = createRelayTransport({
    fetch,
    WebSocket: ObservedSocket as unknown as typeof globalThis.WebSocket,
  });
  transport.pin(publicOrigin, Buffer.from(identity.publicKey).toString("base64url"));
  try {
    const plaintext = await fetch(`${publicOrigin}/oauth/token`, {
      method: "POST",
      body: "secret",
    });
    expect(plaintext.status).toBe(426);
    expect(requests).toEqual([]);
    const body = new Uint8Array(9 * 1024 * 1024).fill(37);
    const frame = new Uint8Array(240_000).fill(38);
    const response = await transport.fetch(`${publicOrigin}/api/private?path=secret-file`, {
      method: "POST",
      headers: { authorization: "Bearer endpoint-secret" },
      body,
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("x-result")).toBe("encrypted");
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(body))).toBe(true);
    const socket = new transport.WebSocket(
      publicOrigin.replace(/^http/, "ws") + "/ws?wsTicket=secret-ticket",
    );
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("socket failed"));
    });
    socket.binaryType = "arraybuffer";
    const received = new Promise<ArrayBuffer>((resolve) => {
      socket.onmessage = (event) => resolve(event.data);
    });
    socket.send(frame);
    expect(new Uint8Array(await received)).toEqual(frame);
    socket.close();
    expect(requests).toEqual(["/api/private?path=secret-file"]);
    const originalRequest = globalThis.Request;
    const originalResponse = globalThis.Response;
    const originalMessageEvent = globalThis.MessageEvent;
    try {
      globalThis.Request = NativeFetch.Request;
      globalThis.Response = NativeFetch.Response;
      Reflect.set(globalThis, "MessageEvent", undefined);
      const native = createRelayTransport({
        fetch,
        WebSocket: ObservedSocket as unknown as typeof globalThis.WebSocket,
        bufferedResponses: true,
      });
      native.pin(publicOrigin, Buffer.from(identity.publicKey).toString("base64url"));
      const nativeResponse = await native.fetch(`${publicOrigin}/api/native`, {
        method: "POST",
        headers: { authorization: "Bearer endpoint-secret" },
        body: new TextEncoder().encode("原生请求🔐"),
      });
      expect(await nativeResponse.text()).toBe("原生请求🔐");
      const nativeSocket = new native.WebSocket(publicOrigin.replace(/^http/, "ws") + "/ws");
      await new Promise<void>((resolve, reject) => {
        nativeSocket.onopen = () => resolve();
        nativeSocket.onerror = () => reject(new Error("Native socket failed"));
      });
      const nativeMessage = new Promise<unknown>((resolve, reject) => {
        nativeSocket.onmessage = (event) => resolve(event.data);
        nativeSocket.onclose = () => reject(new Error("Native message channel closed"));
      });
      nativeSocket.send("原生消息🔐");
      expect(await nativeMessage).toBe("原生消息🔐");
      nativeSocket.close();
    } finally {
      globalThis.Request = originalRequest;
      globalThis.Response = originalResponse;
      globalThis.MessageEvent = originalMessageEvent;
    }
    const bridgeEvents: { type: string; data: string }[] = [];
    let delivered: (() => void) | undefined;
    const bridge = createRelaySocketBridge({
      transport: () => transport,
      receive: (_id, type, data) => {
        bridgeEvents.push({ type, data });
        delivered?.();
      },
    });
    const nextBridgeEvent = (type: string) =>
      new Promise<string>((resolve) => {
        const check = () => {
          const found = bridgeEvents.find((event) => event.type === type);
          if (found) {
            delivered = undefined;
            resolve(found.data);
          }
        };
        delivered = check;
        check();
      });
    bridge({
      id: "preview",
      type: "open",
      data:
        publicOrigin.replace(/^http/, "ws") +
        "/api/preview/tunnel?wsTicket=secret-ticket#relay-e2ee=" +
        Buffer.from(identity.publicKey).toString("base64url"),
    });
    await nextBridgeEvent("open");
    bridge({ id: "preview", type: "send", data: Buffer.from("预览内容🔐").toString("base64") });
    expect(Buffer.from(await nextBridgeEvent("message"), "base64").toString()).toBe("预览内容🔐");
    bridge({ id: "preview", type: "close", data: "" });
    bridgeEvents.length = 0;
    bridge({
      id: "untrusted",
      type: "open",
      data:
        "wss://untrusted.invalid/preview#relay-e2ee=" +
        Buffer.from(identity.publicKey).toString("base64url"),
    });
    await nextBridgeEvent("close");
    const wrong = createRelayTransport({
      fetch,
      WebSocket: WebSocket as unknown as typeof globalThis.WebSocket,
    });
    wrong.pin(publicOrigin, Buffer.from(generateNoiseKeyPair().publicKey).toString("base64url"));
    await expect(wrong.fetch(`${publicOrigin}/api/private`)).rejects.toThrow();
    expect(requests).toHaveLength(2);
    expect(plaintextObserved).toBe(false);
    await NodeFSP.mkdir("/tmp/murmur-relay-e2ee", { recursive: true });
    await NodeFSP.writeFile(
      "/tmp/murmur-relay-e2ee/gateway.json",
      JSON.stringify(
        {
          plaintextRejected: true,
          bufferedNativeRequestVerified: true,
          nativeWebSocketEventVerified: true,
          nativePreviewBridgeVerified: true,
          httpBinaryBytes: body.length,
          webSocketBinaryBytes: frame.length,
          wrongIdentityRejected: true,
          forwardedRequests: requests.length,
          ciphertextFrames,
          plaintextObserved,
        },
        null,
        2,
      ),
    );
  } finally {
    await gateway.close();
    upstreamWs.close();
    origin.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      origin.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
