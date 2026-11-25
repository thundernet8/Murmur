import { normalizeSecureRelayUrl } from "@murmur/shared/relayUrl";

const STORAGE_KEY = "murmur.relay-url";
let relayUrlOverride: string | null = null;
let loading: Promise<void> | undefined;

export function getRelayUrlOverride(): string | null {
  return relayUrlOverride;
}

export function loadRelayClientSettings(): Promise<void> {
  loading ??= (async () => {
    const { whenProtectedDataAvailable } = await import("../../lib/protectedData");
    await whenProtectedDataAvailable();
    const storage = await import("expo-secure-store");
    try {
      relayUrlOverride = normalizeSecureRelayUrl((await storage.getItemAsync(STORAGE_KEY)) ?? "");
    } catch (error) {
      console.warn("Could not read the client relay address.", error);
    }
  })();
  return loading;
}

export async function saveRelayUrlOverride(address: string | null): Promise<void> {
  const storage = await import("expo-secure-store");
  if (address === null) {
    await storage.deleteItemAsync(STORAGE_KEY);
  } else {
    const normalized = normalizeSecureRelayUrl(address);
    if (!normalized) throw new Error("Invalid relay address");
    await storage.setItemAsync(STORAGE_KEY, normalized);
  }
}
