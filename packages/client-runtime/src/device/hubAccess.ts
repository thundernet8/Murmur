import { protectRelayUrl } from "@t3tools/shared/relayTransport";

export interface DeviceHubAccess {
  readonly httpBase: string;
  readonly wsBase: string;
  readonly query: Readonly<Record<string, string>>;
  readonly credentials: boolean;
  readonly encrypted?: boolean;
  readonly relayPublicKey?: string;
}

export const withDeviceHubQuery = (url: string, access: DeviceHubAccess): string => {
  const entries = Object.entries(access.query);
  if (entries.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  const result = `${url}${separator}${new URLSearchParams(entries).toString()}`;
  return access.encrypted ? protectRelayUrl(result) : result;
};
