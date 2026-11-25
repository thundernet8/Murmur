// @effect-diagnostics-next-line nodeBuiltinImport:off -- 此适配器需要流式 Node HTTP 和 WebSocket upgrade 共用一个 listener。
import * as NodeHttp from "node:http";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import {
  RELAY_E2EE_PATH,
  RELAY_E2EE_PROLOGUE,
  decodeRelayTunnelControl,
  type RelayTunnelControl,
} from "@murmur/contracts/relayE2ee";
import {
  createNoiseResponder,
  type NoiseKeyPair,
  type TransportKeys,
} from "@murmur/shared/relayE2ee/noise";
import { decodeRecord, encodeRecord } from "@murmur/shared/relayE2ee/records";

const PUBLIC_CONTROL_PATHS = new Set(["/api/t3-connect/health", "/api/t3-connect/mint-credential"]);
const HOP_HEADERS = new Set([
  "host",
  "connection",
  "upgrade",
  "transfer-encoding",
  "content-length",
  "proxy-authorization",
  "proxy-connection",
]);
const control = (value: RelayTunnelControl) => JSON.stringify(value);
const bytes = (data: RawData) =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : data instanceof ArrayBuffer
      ? Buffer.from(data)
      : data;

function forwardedHeaders(input: Record<string, string>, host: string): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(input).filter(([name]) => !HOP_HEADERS.has(name.toLowerCase())),
    ),
    host,
  };
}

export async function startEncryptedRelayGateway(input: { origin: string; keyPair: NoiseKeyPair }) {
  const target = new URL(input.origin);
  if (
    target.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(target.hostname) ||
    target.username ||
    target.password
  )
    throw new Error("Relay target must be loopback HTTP");
  const server = NodeHttp.createServer((request, response) => {
    if (request.method !== "POST" || !PUBLIC_CONTROL_PATHS.has(request.url ?? "")) {
      response
        .writeHead(426, { "content-type": "text/plain", "cache-control": "no-store" })
        .end("Encrypted relay required; update and pair again");
      return;
    }
    const upstream = NodeHttp.request(
      new URL(request.url!, target),
      {
        method: "POST",
        headers: forwardedHeaders(
          Object.fromEntries(
            Object.entries(request.headers).flatMap(([key, value]) =>
              typeof value === "string" ? [[key, value]] : [],
            ),
          ),
          request.headers.host ?? target.host,
        ),
      },
      (result) => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  });
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024 + 4096,
    perMessageDeflate: false,
  });
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== RELAY_E2EE_PATH) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, (connection) =>
      sockets.emit("connection", connection, request),
    );
  });
  sockets.on("connection", (connection, request) => {
    const handshake = createNoiseResponder({
      localStatic: input.keyPair,
      prologue: new TextEncoder().encode(RELAY_E2EE_PROLOGUE),
    });
    let keys: TransportKeys | undefined;
    let mode: "http" | "ws" | undefined;
    let upstreamSocket: WebSocket | undefined;
    let upstreamRequest: NodeHttp.ClientRequest | undefined;
    let upstreamResponse: NodeHttp.IncomingMessage | undefined;
    let responseReader: AsyncIterator<Buffer> | undefined;
    let uploadEnded = false;
    let pulling = false;
    let pendingUpload = false;
    // @effect-diagnostics-next-line globalTimers:off -- 原生 WebSocket 握手的生命周期由 listener 管理。
    const timer = setTimeout(() => connection.close(1008, "Handshake required"), 10_000);
    const cleanup = () => {
      clearTimeout(timer);
      keys?.send.clear();
      keys?.receive.clear();
      upstreamSocket?.terminate();
      upstreamRequest?.destroy();
      upstreamResponse?.destroy();
    };
    connection.on("close", cleanup);
    const fail = () => {
      cleanup();
      connection.close(1008, "Invalid encrypted relay record");
    };
    connection.on("error", cleanup);
    const send = (value: string | Uint8Array) => {
      if (!keys || connection.readyState !== WebSocket.OPEN) return;
      connection.send(encodeRecord(keys.send, value));
    };
    connection.on("message", (raw, binary) => {
      try {
        if (!binary) throw new Error("Ciphertext required");
        const wire = bytes(raw);
        if (!keys) {
          const offered = handshake.readMessage(wire);
          if (offered.length !== 1 || offered[0] !== 1) throw new Error("Unsupported version");
          connection.send(handshake.writeMessage(new Uint8Array([1])));
          keys = handshake.split();
          clearTimeout(timer);
          return;
        }
        const value = decodeRecord(keys.receive, wire);
        if (mode === "ws") {
          if (upstreamSocket?.readyState !== WebSocket.OPEN) throw new Error("Socket is not open");
          if (upstreamSocket.bufferedAmount > 8 * 1024 * 1024) throw new Error("Send buffer full");
          upstreamSocket.send(value, { binary: typeof value !== "string" });
          return;
        }
        if (mode === "http" && typeof value !== "string") {
          if (uploadEnded || pendingUpload || !upstreamRequest)
            throw new Error("Invalid upload state");
          pendingUpload = true;
          upstreamRequest.write(value, (error) => {
            pendingUpload = false;
            if (error) fail();
            else send(control({ type: "ack" }));
          });
          return;
        }
        if (typeof value !== "string") throw new Error("Missing control message");
        const message = decodeRelayTunnelControl(value);
        if (mode === undefined && (message.type === "http" || message.type === "ws")) {
          if (
            !message.url.startsWith("/") ||
            message.url.startsWith("//") ||
            message.url.includes("\\") ||
            /[\r\n\0]/.test(message.url)
          )
            throw new Error("Invalid request path");
          const url = new URL(message.url, target);
          if (url.origin !== target.origin || url.pathname === RELAY_E2EE_PATH)
            throw new Error("Invalid target");
          mode = message.type;
          if (message.type === "ws") {
            url.protocol = "ws:";
            upstreamSocket = new WebSocket(url, [...message.protocols], {
              headers: {
                host: request.headers.host ?? target.host,
                "x-forwarded-proto":
                  request.headers["x-forwarded-proto"] === "https" ? "https" : "http",
                ...(request.headers.origin ? { origin: request.headers.origin } : {}),
              },
              maxPayload: 8 * 1024 * 1024,
              perMessageDeflate: false,
            });
            upstreamSocket.on("open", () =>
              send(control({ type: "open", protocol: upstreamSocket!.protocol })),
            );
            upstreamSocket.on("message", (data, isBinary) => {
              if (connection.bufferedAmount > 8 * 1024 * 1024) {
                fail();
                return;
              }
              send(isBinary ? bytes(data) : bytes(data).toString("utf8"));
            });
            upstreamSocket.on("close", () => connection.close(4003, "Upstream closed"));
            upstreamSocket.on("error", fail);
          } else {
            const headers = forwardedHeaders(message.headers, request.headers.host ?? target.host);
            headers["x-forwarded-proto"] =
              request.headers["x-forwarded-proto"] === "https" ? "https" : "http";
            // Origin 由外层连接决定，密文请求不能伪造本地浏览器来源。
            if (request.headers.origin) headers.origin = request.headers.origin;
            upstreamRequest = NodeHttp.request(
              url,
              { method: message.method, headers },
              (response) => {
                upstreamResponse = response;
                responseReader = response[Symbol.asyncIterator]();
                send(
                  control({
                    type: "response",
                    status: response.statusCode ?? 502,
                    headers: Object.fromEntries(
                      Object.entries(response.headers).flatMap(([key, value]) =>
                        HOP_HEADERS.has(key) || value === undefined
                          ? []
                          : [[key, Array.isArray(value) ? value.join(", ") : value]],
                      ),
                    ),
                  }),
                );
              },
            );
            upstreamRequest.on("error", fail);
            send(control({ type: "ack" }));
          }
        } else if (mode === "http" && message.type === "end" && !uploadEnded && !pendingUpload) {
          uploadEnded = true;
          upstreamRequest!.end();
        } else if (mode === "http" && message.type === "pull" && responseReader && !pulling) {
          pulling = true;
          void responseReader
            .next()
            .then((next) => {
              pulling = false;
              send(next.done ? control({ type: "end" }) : next.value);
            })
            .catch(fail);
        } else throw new Error("Invalid control state");
      } catch {
        fail();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Relay gateway did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const socket of sockets.clients) socket.terminate();
      sockets.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
