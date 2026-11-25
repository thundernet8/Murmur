// Copyright (c) 2025-present Mohamed Boudra. Apache-2.0，见 LICENSE。
// 改编自 Paseo Noise；调整模块路径和 noble 1.x API，协议保持 Noise revision 34。
import { chacha20poly1305 } from "@noble/ciphers/chacha";

export const NOISE_TAG_BYTES = 16;
export const NOISE_MAX_MESSAGE_BYTES = 65535;
const MAX_NONCE = (1n << 64n) - 1n;

// @effect-diagnostics-next-line extendsNativeError:off -- 上游 Noise 的同步协议异常不进入 Effect failure channel。
export class NoiseProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoiseProtocolError";
  }
}

export class CipherState {
  private k: Uint8Array | null = null;
  private n = 0n;

  initializeKey(key: Uint8Array | null, nonce = 0n): void {
    this.k = key;
    this.n = nonce;
  }

  hasKey(): boolean {
    return this.k !== null;
  }

  nonce(): bigint {
    return this.n;
  }

  encryptWithAd(ad: Uint8Array, plaintext: Uint8Array): Uint8Array {
    if (this.k === null) return plaintext;
    const nonce = this.takeNonce();
    return chacha20poly1305(this.k, nonce, ad).encrypt(plaintext);
  }

  decryptWithAd(ad: Uint8Array, ciphertext: Uint8Array): Uint8Array {
    if (this.k === null) return ciphertext;
    if (this.n === MAX_NONCE) throw new NoiseProtocolError("nonce exhausted");
    let plaintext: Uint8Array;
    try {
      plaintext = chacha20poly1305(this.k, encodeNonce(this.n), ad).decrypt(ciphertext);
    } catch {
      throw new NoiseProtocolError("authentication failed");
    }
    this.n += 1n;
    return plaintext;
  }

  private takeNonce(): Uint8Array {
    if (this.n === MAX_NONCE) throw new NoiseProtocolError("nonce exhausted");
    const nonce = encodeNonce(this.n);
    this.n += 1n;
    return nonce;
  }

  clear(): void {
    this.k?.fill(0);
    this.k = null;
    this.n = MAX_NONCE;
  }
}

function encodeNonce(n: bigint): Uint8Array {
  const nonce = new Uint8Array(12);
  let value = n;
  for (let i = 4; i < 12; i += 1) {
    nonce[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return nonce;
}
