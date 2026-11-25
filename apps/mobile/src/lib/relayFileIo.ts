import type { createRelayTransport } from "@murmur/shared/relayTransport";
import type { File } from "expo-file-system";

export function encryptedRelayTransport(url: string) {
  const transport = (
    globalThis as typeof globalThis & {
      __murmurRelayTransport?: ReturnType<typeof createRelayTransport>;
    }
  ).__murmurRelayTransport;
  return transport?.isEncrypted(url) ? transport : undefined;
}

export async function downloadRelayFile(
  url: string,
  file: File,
  signal: AbortSignal,
): Promise<boolean> {
  const transport = encryptedRelayTransport(url);
  if (!transport && !url.startsWith("data:")) return false;
  if (signal.aborted) throw new Error("Download cancelled");
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma < 0 || !url.slice(0, comma).endsWith(";base64"))
      throw new Error("Invalid inline file");
    file.create({ overwrite: true });
    await file.write(url.slice(comma + 1), { encoding: "base64" });
  } else {
    const response = await transport!.fetch(url, { signal });
    if (!response.ok) throw new Error("Encrypted download failed");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal.aborted) throw new Error("Download cancelled");
    file.create({ overwrite: true });
    await file.write(bytes);
  }
  return true;
}
