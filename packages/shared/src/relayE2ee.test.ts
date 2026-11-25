import { describe, expect, it } from "vite-plus/test";
import { x25519 } from "@noble/curves/ed25519";
import { createNoiseInitiator, createNoiseResponder } from "./relayE2ee/noise.ts";
import { decodeRecord, encodeRecord } from "./relayE2ee/records.ts";

const key = (seed: number) => {
  const secretKey = new Uint8Array(32).fill(seed);
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
};
const prologue = new TextEncoder().encode("murmur-relay-e2ee/1");
function handshake(seed = 3) {
  const serverKey = key(1);
  const client = createNoiseInitiator({
    remoteStatic: serverKey.publicKey,
    prologue,
    ephemeral: key(2),
  });
  const server = createNoiseResponder({ localStatic: serverKey, prologue, ephemeral: key(seed) });
  const hello = client.writeMessage(new Uint8Array([1]));
  expect(server.readMessage(hello)).toEqual(new Uint8Array([1]));
  const ready = server.writeMessage(new Uint8Array([1]));
  expect(client.readMessage(ready)).toEqual(new Uint8Array([1]));
  return { client: client.split(), server: server.split(), hello };
}

describe("relay 端点加密", () => {
  it("保留文本和二进制类型，并分块保护大帧", () => {
    const { client, server } = handshake();
    for (const data of [
      "凭证与代码🔐",
      "",
      new Uint8Array([0, 255, 1]),
      new Uint8Array(180_000).fill(42),
    ]) {
      const encrypted = encodeRecord(client.send, data);
      expect(decodeRecord(server.receive, encrypted)).toEqual(data);
    }
    expect(decodeRecord(client.receive, encodeRecord(server.send, "response"))).toBe("response");
  });

  it("拒绝错误公钥、协议上下文、明文和未完成的握手", () => {
    for (const wrong of ["key", "prologue"]) {
      const client = createNoiseInitiator({
        remoteStatic: key(wrong === "key" ? 4 : 1).publicKey,
        prologue,
        ephemeral: key(2),
      });
      const server = createNoiseResponder({
        localStatic: key(1),
        prologue: wrong === "prologue" ? new Uint8Array([0]) : prologue,
        ephemeral: key(3),
      });
      expect(() => server.readMessage(client.writeMessage(new Uint8Array([1])))).toThrow();
    }
    const pending = createNoiseResponder({ localStatic: key(1), prologue });
    expect(() => pending.split()).toThrow();
    expect(() => pending.readMessage(new TextEncoder().encode('{"method":"execute"}'))).toThrow();
  });

  it("拒绝篡改、重复、乱序、反射、截断及跨会话重放", () => {
    for (const attack of ["tamper", "duplicate", "reorder", "reflect", "truncate", "session"]) {
      const { client, server } = handshake();
      const first = encodeRecord(client.send, "secret-token");
      let wire = first;
      let receiver = server.receive;
      if (attack === "tamper") {
        wire = first.slice();
        wire[wire.length - 1] = wire[wire.length - 1]! ^ 1;
      }
      if (attack === "duplicate") decodeRecord(receiver, first);
      if (attack === "reorder") wire = encodeRecord(client.send, "second");
      if (attack === "reflect") receiver = client.receive;
      if (attack === "truncate") wire = first.slice(0, -1);
      if (attack === "session") receiver = handshake(4).server.receive;
      expect(() => decodeRecord(receiver, wire), attack).toThrow();
    }
  });

  it("拒绝记录尾随数据和超限声明，关闭后不能继续使用密钥", () => {
    const { client, server } = handshake();
    const wire = encodeRecord(client.send, "body");
    const trailing = new Uint8Array(wire.length + 1);
    trailing.set(wire);
    expect(() => decodeRecord(server.receive, trailing)).toThrow();
    client.send.clear();
    expect(() => encodeRecord(client.send, "after close")).toThrow();
  });
});
