// Copyright (c) 2025-present Mohamed Boudra. Apache-2.0，见 LICENSE。
// 改编自 Paseo Noise；调整模块路径和 noble 1.x API，协议保持 Noise revision 34。
import { x25519 } from "@noble/curves/ed25519";
import { CipherState, NoiseProtocolError, NOISE_MAX_MESSAGE_BYTES } from "./cipher-state.ts";
import { SymmetricState, concat } from "./symmetric-state.ts";

export {
  CipherState,
  NoiseProtocolError,
  NOISE_MAX_MESSAGE_BYTES,
  NOISE_TAG_BYTES,
} from "./cipher-state.ts";

export const NOISE_NK_PROTOCOL_NAME = "Noise_NK_25519_ChaChaPoly_SHA256";
export const DH_BYTES = 32;

export interface NoiseKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export interface NoiseInitiatorOptions {
  remoteStatic: Uint8Array;
  prologue: Uint8Array;
  ephemeral?: NoiseKeyPair;
}

export interface NoiseResponderOptions {
  localStatic: NoiseKeyPair;
  prologue: Uint8Array;
  ephemeral?: NoiseKeyPair;
}

export interface TransportKeys {
  send: CipherState;
  receive: CipherState;
}

export interface NoiseHandshake {
  writeMessage(payload: Uint8Array): Uint8Array;
  readMessage(message: Uint8Array): Uint8Array;
  isComplete(): boolean;
  handshakeHash(): Uint8Array;
  split(): { send: CipherState; receive: CipherState };
}

type Token = "e" | "es" | "ee";
const NK_MESSAGES: ReadonlyArray<ReadonlyArray<Token>> = [
  ["e", "es"],
  ["e", "ee"],
];

export function generateNoiseKeyPair(): NoiseKeyPair {
  const secretKey = x25519.utils.randomPrivateKey();
  return { secretKey, publicKey: x25519.getPublicKey(secretKey) };
}

export function relayKeyPairFromSecret(secretKey: Uint8Array): NoiseKeyPair {
  requireKeyLength(secretKey, "static secret key");
  return { secretKey: secretKey.slice(), publicKey: x25519.getPublicKey(secretKey) };
}

export function createNoiseInitiator(options: NoiseInitiatorOptions): NoiseHandshake {
  requireKeyLength(options.remoteStatic, "remote static key");
  return new HandshakeState({
    initiator: true,
    prologue: options.prologue,
    s: null,
    rs: options.remoteStatic,
    ephemeral: options.ephemeral ?? null,
  });
}

export function createNoiseResponder(options: NoiseResponderOptions): NoiseHandshake {
  requireKeyLength(options.localStatic.publicKey, "local static public key");
  requireKeyLength(options.localStatic.secretKey, "local static secret key");
  return new HandshakeState({
    initiator: false,
    prologue: options.prologue,
    s: options.localStatic,
    rs: null,
    ephemeral: options.ephemeral ?? null,
  });
}

class HandshakeState implements NoiseHandshake {
  private readonly symmetric = new SymmetricState(NOISE_NK_PROTOCOL_NAME);
  private readonly initiator: boolean;
  private readonly s: NoiseKeyPair | null;
  private e: NoiseKeyPair | null;
  private rs: Uint8Array | null;
  private re: Uint8Array | null = null;
  private messageIndex = 0;
  private finished = false;

  constructor(params: {
    initiator: boolean;
    prologue: Uint8Array;
    s: NoiseKeyPair | null;
    rs: Uint8Array | null;
    ephemeral: NoiseKeyPair | null;
  }) {
    this.initiator = params.initiator;
    this.s = params.s;
    this.rs = params.rs;
    this.e = params.ephemeral;
    this.symmetric.mixHash(params.prologue);
    const preMessageStatic = this.initiator ? this.rs : this.s?.publicKey;
    if (!preMessageStatic) throw new NoiseProtocolError("missing responder static key");
    this.symmetric.mixHash(preMessageStatic);
  }

  writeMessage(payload: Uint8Array): Uint8Array {
    const tokens = this.nextTokens(this.initiator);
    const parts: Uint8Array[] = [];
    for (const token of tokens) {
      switch (token) {
        case "e": {
          if (!this.e) this.e = generateNoiseKeyPair();
          parts.push(this.e.publicKey);
          this.symmetric.mixHash(this.e.publicKey);
          break;
        }
        case "es":
          this.mixDh(this.initiator ? this.e : this.s, this.initiator ? this.rs : this.re);
          break;
        case "ee":
          this.mixDh(this.e, this.re);
          break;
      }
    }
    parts.push(this.symmetric.encryptAndHash(payload));
    const message = concat(...parts);
    if (message.byteLength > NOISE_MAX_MESSAGE_BYTES) {
      throw new NoiseProtocolError("handshake message too large");
    }
    this.advance();
    return message;
  }

  readMessage(message: Uint8Array): Uint8Array {
    if (message.byteLength > NOISE_MAX_MESSAGE_BYTES) {
      throw new NoiseProtocolError("handshake message too large");
    }
    const tokens = this.nextTokens(!this.initiator);
    let offset = 0;
    for (const token of tokens) {
      switch (token) {
        case "e": {
          if (message.byteLength < offset + DH_BYTES) {
            throw new NoiseProtocolError("handshake message truncated");
          }
          this.re = message.slice(offset, offset + DH_BYTES);
          offset += DH_BYTES;
          this.symmetric.mixHash(this.re);
          break;
        }
        case "es":
          this.mixDh(this.initiator ? this.e : this.s, this.initiator ? this.rs : this.re);
          break;
        case "ee":
          this.mixDh(this.e, this.re);
          break;
      }
    }
    const payload = this.symmetric.decryptAndHash(message.slice(offset));
    this.advance();
    return payload;
  }

  isComplete(): boolean {
    return this.messageIndex >= NK_MESSAGES.length;
  }

  handshakeHash(): Uint8Array {
    return this.symmetric.handshakeHash();
  }

  split(): { send: CipherState; receive: CipherState } {
    if (!this.isComplete()) throw new NoiseProtocolError("handshake incomplete");
    if (this.finished) throw new NoiseProtocolError("handshake already split");
    this.finished = true;
    const [c1, c2] = this.symmetric.split();
    this.e?.secretKey.fill(0);
    this.e = null;
    return this.initiator ? { send: c1, receive: c2 } : { send: c2, receive: c1 };
  }

  private nextTokens(expectedWriterIsInitiator: boolean): ReadonlyArray<Token> {
    if (this.isComplete() || this.finished) throw new NoiseProtocolError("handshake complete");
    const writerIsInitiator = this.messageIndex % 2 === 0;
    if (writerIsInitiator !== expectedWriterIsInitiator) {
      throw new NoiseProtocolError("handshake message out of turn");
    }
    return NK_MESSAGES[this.messageIndex]!;
  }

  private advance(): void {
    this.messageIndex += 1;
  }

  private mixDh(local: NoiseKeyPair | null, remote: Uint8Array | null): void {
    if (!local || !remote) throw new NoiseProtocolError("missing DH key");
    let shared: Uint8Array;
    try {
      shared = x25519.getSharedSecret(local.secretKey, remote);
    } catch {
      throw new NoiseProtocolError("invalid DH public key");
    }
    if (isAllZero(shared)) throw new NoiseProtocolError("invalid DH public key");
    this.symmetric.mixKey(shared);
    shared.fill(0);
  }
}

function requireKeyLength(key: Uint8Array, label: string): void {
  if (key.byteLength !== DH_BYTES) throw new NoiseProtocolError(`${label} must be 32 bytes`);
}

function isAllZero(bytes: Uint8Array): boolean {
  let acc = 0;
  for (const byte of bytes) acc |= byte;
  return acc === 0;
}
