import { normalizeSecureRelayUrl } from "@murmur/shared/relayUrl";

const STORAGE_KEY = "murmur.relay-url";

function readRelayUrlOverride(): string | null {
  try {
    return normalizeSecureRelayUrl(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "");
  } catch {
    return null;
  }
}

// 连接运行时与所有调用方在一次页面生命周期内使用同一个地址，保存后统一重新加载。
export const relayUrlOverride = readRelayUrlOverride();

export function saveRelayUrlOverride(address: string | null): void {
  if (address === null) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    const normalized = normalizeSecureRelayUrl(address);
    if (!normalized) throw new Error("Invalid relay address");
    localStorage.setItem(STORAGE_KEY, normalized);
  }
}
