/// <reference lib="dom" />
import {
  RELAY_E2EE_PATH,
  RELAY_E2EE_PROLOGUE,
  decodeRelayTunnelControl,
  type RelayTunnelControl,
} from "@t3tools/contracts/relayE2ee";
import {
  createNoiseInitiator,
  relayKeyPairFromSecret,
  type TransportKeys,
} from "./relayE2ee/noise.ts";
import { decodeRecord, encodeRecord } from "./relayE2ee/records.ts";

export function decodeRelayPublicKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("Invalid relay identity");
  const bytes = Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/") + "="), (c) =>
    c.charCodeAt(0),
  );
  if (bytes.length !== 32) throw new Error("Invalid relay identity");
  return bytes;
}

const httpOrigin = (url: string) => new URL(url.replace(/^ws/, "http")).origin;
const control = (value: RelayTunnelControl) => JSON.stringify(value);

export function protectRelayUrl(value: string): string {
  const url = new URL(value);
  const path = new TextEncoder().encode(url.pathname + url.search);
  const encoded = btoa(Array.from(path, (byte) => String.fromCharCode(byte)).join(""));
  return `${url.origin}/#relay=${encodeURIComponent(encoded)}`;
}

function privateUrl(value: string): URL {
  const url = new URL(value, typeof location === "undefined" ? undefined : location.href);
  if (url.hash.startsWith("#relay=")) {
    const path = new TextDecoder().decode(
      Uint8Array.from(atob(decodeURIComponent(url.hash.slice(7))), (c) => c.charCodeAt(0)),
    );
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
      throw new Error("Invalid encrypted relay URL");
    return new URL(path, url.origin);
  }
  return url;
}

function bufferedResponseBody(response: Response): Response {
  // React Native 的 fetch polyfill 按 Latin-1 读取 ArrayBuffer，须显式解码 UTF-8。
  const arrayBuffer = response.arrayBuffer.bind(response);
  const clone = response.clone.bind(response);
  response.text = async () => new TextDecoder().decode(await arrayBuffer());
  response.json = async () => JSON.parse(await response.text());
  response.clone = () => bufferedResponseBody(clone());
  return response;
}

export function createRelayTransport(platform: {
  fetch: typeof fetch;
  WebSocket: typeof WebSocket;
  randomBytes?: (size: number) => Uint8Array;
  bufferedResponses?: boolean;
  cacheAsset?: (bytes: Uint8Array, mimeType: string) => Promise<string>;
}) {
  const pins = new Map<string, string>();
  function pin(origin: string, publicKey: string) {
    decodeRelayPublicKey(publicKey);
    const normalized = httpOrigin(origin);
    pins.set(normalized, publicKey);
  }

  function open(
    url: string,
    publicKey: string,
    events: {
      ready: (send: (value: string | Uint8Array) => void) => void;
      message: (value: string | Uint8Array) => void;
      close: (error: Error) => void;
    },
  ) {
    const endpoint = new URL(RELAY_E2EE_PATH, url.replace(/^ws/, "http"));
    endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
    const socket = new platform.WebSocket(endpoint);
    socket.binaryType = "arraybuffer";
    const handshake = createNoiseInitiator({
      remoteStatic: decodeRelayPublicKey(publicKey),
      prologue: new TextEncoder().encode(RELAY_E2EE_PROLOGUE),
      ...(platform.randomBytes
        ? { ephemeral: relayKeyPairFromSecret(platform.randomBytes(32)) }
        : {}),
    });
    let keys: TransportKeys | undefined;
    let closed = false;
    const fail = () => {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      keys?.send.clear();
      keys?.receive.clear();
      socket.close(4003, "Encrypted relay channel closed");
      events.close(new Error("Encrypted relay channel closed"));
    };
    // @effect-diagnostics-next-line globalTimers:off -- 原生 WebSocket 适配边界不运行 Effect runtime。
    const timer = setTimeout(fail, 10_000);
    const send = (value: string | Uint8Array) => {
      if (closed || !keys) throw new Error("Encrypted channel is not ready");
      socket.send(new Uint8Array(encodeRecord(keys.send, value)));
    };
    socket.onopen = () => socket.send(new Uint8Array(handshake.writeMessage(new Uint8Array([1]))));
    socket.onmessage = (event) => {
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new Error("Expected ciphertext");
        const bytes = new Uint8Array(event.data);
        if (!keys) {
          const selected = handshake.readMessage(bytes);
          if (selected.length !== 1 || selected[0] !== 1)
            throw new Error("Unsupported encryption version");
          keys = handshake.split();
          clearTimeout(timer);
          events.ready(send);
        } else events.message(decodeRecord(keys.receive, bytes));
      } catch {
        fail();
      }
    };
    socket.onclose = fail;
    socket.onerror = fail;
    return { close: fail };
  }

  const encryptedFetch: typeof fetch = async (input, init) => {
    const url = privateUrl(input instanceof Request ? input.url : String(input));
    const publicKey = pins.get(url.origin);
    if (publicKey === undefined) return platform.fetch(input, init);
    const request = new Request(input, init);
    if (request.signal.aborted) throw new Error("Request aborted");
    return await new Promise<Response>((resolve, reject) => {
      let send: ((value: string | Uint8Array) => void) | undefined;
      let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel"> | undefined;
      let uploadBytes: Uint8Array | undefined;
      let uploadOffset = 0;
      let stream: ReadableStreamDefaultController<Uint8Array> | undefined;
      let responseStarted = false;
      let responseResolved = false;
      let bufferedResponse: ResponseInit | undefined;
      let responseBytes = 0;
      const responseParts: Uint8Array[] = [];
      let ended = false;
      const abort = () => channel.close();
      const channel = open(url.href, publicKey, {
        ready: (write) => {
          send = write;
          void (async () => {
            reader = request.body?.getReader();
            if (!reader && request.method !== "GET" && request.method !== "HEAD") {
              const bytes = new Uint8Array(await request.arrayBuffer());
              let consumed = false;
              reader = {
                read: async () => {
                  if (consumed) return { done: true, value: undefined };
                  consumed = true;
                  return { done: false, value: bytes };
                },
                cancel: async () => {
                  consumed = true;
                },
              };
            }
            write(
              control({
                type: "http",
                url: url.pathname + url.search,
                method: request.method,
                headers: Object.fromEntries(request.headers),
              }),
            );
          })().catch(() => channel.close());
        },
        message: (value) => {
          if (typeof value !== "string") {
            if (!responseStarted) throw new Error("Unexpected response data");
            if (bufferedResponse) {
              responseParts.push(value);
              responseBytes += value.length;
              send!(control({ type: "pull" }));
              return;
            }
            if (!stream) throw new Error("Unexpected response data");
            stream.enqueue(value);
            return;
          }
          const message = decodeRelayTunnelControl(value);
          if (message.type === "ack") {
            void (async () => {
              if (responseStarted) return;
              if (!uploadBytes || uploadOffset === uploadBytes.length) {
                const next = await reader?.read();
                if (!next || next.done) {
                  send!(control({ type: "end" }));
                  return;
                }
                uploadBytes = next.value;
                uploadOffset = 0;
              }
              const chunk = uploadBytes.subarray(uploadOffset, uploadOffset + 64 * 1024);
              uploadOffset += chunk.length;
              send!(chunk);
            })().catch(() => channel.close());
          } else if (message.type === "response" && !responseStarted) {
            responseStarted = true;
            void reader?.cancel().catch(() => {});
            uploadBytes = undefined;
            const noBody =
              request.method === "HEAD" || [101, 204, 205, 304].includes(message.status);
            if (platform.bufferedResponses && !noBody) {
              bufferedResponse = { status: message.status, headers: message.headers };
              send!(control({ type: "pull" }));
              return;
            }
            const body = noBody
              ? null
              : new ReadableStream<Uint8Array>(
                  {
                    start: (controller) => {
                      stream = controller;
                    },
                    pull: () => {
                      send!(control({ type: "pull" }));
                    },
                    cancel: () => {
                      ended = true;
                      channel.close();
                    },
                  },
                  { highWaterMark: 0 },
                );
            responseResolved = true;
            resolve(
              new Response(body, {
                status: message.status,
                headers: message.headers,
              }),
            );
            if (noBody) {
              ended = true;
              channel.close();
            }
          } else if (message.type === "end" && responseStarted) {
            if (bufferedResponse) {
              const bytes = new Uint8Array(responseBytes);
              let offset = 0;
              for (const part of responseParts) {
                bytes.set(part, offset);
                offset += part.length;
              }
              responseResolved = true;
              resolve(bufferedResponseBody(new Response(bytes.buffer, bufferedResponse)));
            }
            ended = true;
            stream?.close();
            channel.close();
          } else throw new Error("Unexpected relay control");
        },
        close: (error) => {
          request.signal.removeEventListener("abort", abort);
          void reader?.cancel().catch(() => {});
          if (!ended) {
            if (responseResolved) stream?.error(error);
            else reject(error);
          }
        },
      });
      request.signal.addEventListener("abort", abort, { once: true });
      if (request.signal.aborted) abort();
    });
  };

  class RelayWebSocket extends EventTarget {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readonly CONNECTING = 0;
    readonly OPEN = 1;
    readonly CLOSING = 2;
    readonly CLOSED = 3;
    readonly url: string;
    readyState = 0;
    protocol = "";
    extensions = "";
    bufferedAmount = 0;
    binaryType: BinaryType = "blob";
    onopen: ((event: Event) => void) | null = null;
    onmessage: ((event: Event & { readonly data: unknown }) => void) | null = null;
    onerror: ((event: Event) => void) | null = null;
    onclose: ((event: CloseEvent) => void) | null = null;
    private write?: (value: string | Uint8Array) => void;
    private channel?: { close: () => void };
    constructor(url: string | URL, protocols?: string | string[]) {
      super();
      this.url = privateUrl(String(url)).href;
      const publicKey = pins.get(httpOrigin(this.url));
      if (!publicKey) return new platform.WebSocket(url, protocols) as unknown as RelayWebSocket;
      this.channel = open(this.url, publicKey, {
        ready: (send) => {
          this.write = send;
          send(
            control({
              type: "ws",
              url: new URL(this.url).pathname + new URL(this.url).search,
              protocols: typeof protocols === "string" ? [protocols] : (protocols ?? []),
            }),
          );
        },
        message: (value) => {
          if (this.readyState === 0) {
            if (typeof value !== "string") throw new Error("Missing socket acknowledgement");
            const message = decodeRelayTunnelControl(value);
            if (message.type !== "open") throw new Error("Missing socket acknowledgement");
            this.protocol = message.protocol;
            this.readyState = 1;
            const event = new Event("open");
            this.dispatchEvent(event);
            this.onopen?.(event);
          } else if (this.readyState === 1) {
            const data =
              typeof value === "string"
                ? value
                : this.binaryType === "blob"
                  ? new Blob([new Uint8Array(value)])
                  : new Uint8Array(value).buffer;
            const event =
              typeof globalThis.MessageEvent === "function"
                ? new MessageEvent("message", { data })
                : Object.assign(new Event("message"), { data });
            this.dispatchEvent(event);
            this.onmessage?.(event);
          }
        },
        close: () => {
          if (this.readyState === 3) return;
          const wasConnecting = this.readyState === 0;
          this.readyState = 3;
          if (wasConnecting) {
            const event = new Event("error");
            this.dispatchEvent(event);
            this.onerror?.(event);
          }
          const event = Object.assign(new Event("close"), {
            code: 4003,
            reason: "Encrypted relay channel closed",
            wasClean: false,
          });
          this.dispatchEvent(event);
          this.onclose?.(event);
        },
      });
    }
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
      if (this.readyState !== 1 || !this.write) throw new Error("WebSocket is not open");
      if (data instanceof Blob) {
        throw new Error("Send binary data as ArrayBuffer over encrypted relay");
      }
      this.write(
        typeof data === "string"
          ? data
          : ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data),
      );
    }
    close() {
      if (this.readyState === 3) return;
      this.readyState = 2;
      this.channel?.close();
    }
  }
  const localAsset = async (url: string) => {
    const response = await encryptedFetch(url);
    if (!response.ok) throw new Error("Encrypted asset request failed");
    const data = new Uint8Array(await response.arrayBuffer());
    const mimeType = response.headers.get("content-type") ?? "application/octet-stream";
    if (platform.cacheAsset) return platform.cacheAsset(data, mimeType);
    let encoded = "";
    for (let offset = 0; offset < data.length; offset += 8192)
      encoded += String.fromCharCode(...data.subarray(offset, offset + 8192));
    return `data:${mimeType};base64,${btoa(encoded)}`;
  };
  return {
    pin,
    fetch: encryptedFetch,
    localAsset,
    WebSocket: RelayWebSocket as unknown as typeof WebSocket,
    isEncrypted: (url: string) => pins.has(httpOrigin(url)),
    publicKey: (url: string) => pins.get(httpOrigin(url)),
  };
}
