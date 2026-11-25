import { type CipherState, NoiseProtocolError } from "./cipher-state.ts";

const EMPTY = new Uint8Array();
const CHUNK_BYTES = 65513;
export const MAX_RECORD_BYTES = 8 * 1024 * 1024;

export function encodeRecord(cipher: CipherState, value: string | Uint8Array): Uint8Array {
  if (!cipher.hasKey()) throw new NoiseProtocolError("missing transport key");
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  if (bytes.length > MAX_RECORD_BYTES) throw new NoiseProtocolError("record too large");
  const count = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  const result = new Uint8Array(bytes.length + count * 24);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const part = bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    const plaintext = new Uint8Array(part.length + 6);
    plaintext[0] = typeof value === "string" ? 0 : 1;
    plaintext[1] = (index === 0 ? 1 : 0) | (index === count - 1 ? 2 : 0);
    new DataView(plaintext.buffer).setUint32(2, bytes.length);
    plaintext.set(part, 6);
    const encrypted = cipher.encryptWithAd(EMPTY, plaintext);
    new DataView(result.buffer).setUint16(offset, encrypted.length);
    result.set(encrypted, offset + 2);
    offset += encrypted.length + 2;
  }
  return result;
}

export function decodeRecord(cipher: CipherState, record: Uint8Array): string | Uint8Array {
  if (!cipher.hasKey()) throw new NoiseProtocolError("missing transport key");
  if (record.length < 24 || record.length > MAX_RECORD_BYTES + 4096)
    throw new NoiseProtocolError("invalid record size");
  let offset = 0;
  let received = 0;
  let kind = -1;
  let total = -1;
  const parts: Uint8Array[] = [];
  while (offset < record.length) {
    if (offset + 2 > record.length) throw new NoiseProtocolError("truncated record");
    const size = new DataView(record.buffer, record.byteOffset + offset, 2).getUint16(0);
    if (size < 22 || offset + 2 + size > record.length)
      throw new NoiseProtocolError("invalid chunk size");
    const plaintext = cipher.decryptWithAd(EMPTY, record.subarray(offset + 2, offset + 2 + size));
    offset += 2 + size;
    const flags = plaintext[1]!;
    const length = new DataView(plaintext.buffer, plaintext.byteOffset + 2, 4).getUint32(0);
    const first = parts.length === 0;
    const last = (flags & 2) !== 0;
    if (first) {
      kind = plaintext[0]!;
      total = length;
    }
    const part = plaintext.subarray(6);
    if (
      kind > 1 ||
      plaintext[0] !== kind ||
      length !== total ||
      total > MAX_RECORD_BYTES ||
      (flags & ~3) !== 0 ||
      ((flags & 1) !== 0) !== first ||
      (!last && part.length !== CHUNK_BYTES) ||
      (last && offset !== record.length)
    )
      throw new NoiseProtocolError("invalid record framing");
    received += part.length;
    if (received > total || (last && received !== total) || (!last && offset === record.length))
      throw new NoiseProtocolError("invalid record length");
    parts.push(part);
  }
  const bytes = new Uint8Array(received);
  let position = 0;
  for (const part of parts) {
    bytes.set(part, position);
    position += part.length;
  }
  return kind === 0 ? new TextDecoder("utf-8", { fatal: true }).decode(bytes) : bytes;
}
