import { createRelayTransport } from "@murmur/shared/relayTransport";
import * as Context from "effect/Context";

export class RelayEncryptionTransport extends Context.Service<
  RelayEncryptionTransport,
  ReturnType<typeof createRelayTransport>
>()("@murmur/client-runtime/relay/encryption/RelayEncryptionTransport") {}

export const relayIdentityConnectionId = (environmentId: string) =>
  `relay-identity:${environmentId}`;
