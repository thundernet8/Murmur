import { relayKeyPairFromSecret } from "@t3tools/shared/relayE2ee/noise";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";
import * as HttpServer from "effect/http/HttpServer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as Socket from "effect/socket/Socket";
import { WebSocket } from "ws";
import { RELAY_E2EE_PATH } from "@t3tools/contracts/relayE2ee";
import { loopbackUrlHostForAddress } from "../startupAccess.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { startEncryptedRelayGateway } from "./EncryptedRelayGateway.ts";

export const getRelayEncryptionKey = Effect.fn("RelayEncryption.key")(function* (
  secrets: ServerSecretStore.ServerSecretStore["Service"],
) {
  const secret = yield* secrets.getOrCreateRandom("relay-noise-x25519", 32);
  return yield* Effect.try({
    try: () => relayKeyPairFromSecret(secret),
    catch: (cause) =>
      new ServerSecretStore.SecretStoreDecodeError({ resource: "relay identity", cause }),
  });
});

export class RelayEncryptionError extends Schema.TaggedError<RelayEncryptionError>()(
  "RelayEncryptionError",
  { cause: Schema.Defect() },
) {}

export class RelayEncryption extends Context.Service<
  RelayEncryption,
  {
    readonly origin: Effect.Effect<string, RelayEncryptionError>;
  }
>()("t3/relay/RelayEncryption") {}

export const layer = Layer.effect(
  RelayEncryption,
  Effect.gen(function* () {
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const http = yield* HttpServer.HttpServer;
    const scope = yield* Scope.Scope;
    const started = yield* SynchronizedRef.make<string | undefined>(undefined);
    return RelayEncryption.of({
      origin: SynchronizedRef.updateAndGetEffect(started, (existing) => {
        if (existing) return Effect.succeed(existing);
        return Effect.gen(function* () {
          const address = http.address;
          if (!("port" in address))
            return yield* new RelayEncryptionError({ cause: "TCP address required" });
          const keyPair = yield* getRelayEncryptionKey(secrets);
          const gateway = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () =>
                startEncryptedRelayGateway({
                  origin: `http://${loopbackUrlHostForAddress(address)}:${address.port}`,
                  keyPair,
                }),
              catch: (cause) => new RelayEncryptionError({ cause }),
            }),
            (running) => Effect.promise(() => running.close()),
          ).pipe(Scope.provide(scope));
          return gateway.origin;
        }).pipe(Effect.mapError((cause) => new RelayEncryptionError({ cause })));
      }).pipe(Effect.map((origin) => origin!)),
    });
  }),
);

export const routeLayer = HttpRouter.add(
  "GET",
  RELAY_E2EE_PATH,
  Effect.gen(function* () {
    const encryption = yield* RelayEncryption;
    const origin = yield* encryption.origin;
    const request = yield* HttpServerRequest.HttpServerRequest;
    const upstream = yield* Socket.makeWebSocket(
      origin.replace(/^http/, "ws") + RELAY_E2EE_PATH,
    ).pipe(
      Effect.provideService(
        Socket.WebSocketConstructor,
        (url) =>
          new WebSocket(url, {
            headers: {
              host: request.headers.host ?? "localhost",
              ...(request.headers.origin ? { origin: request.headers.origin } : {}),
              "x-forwarded-proto":
                request.headers["x-forwarded-proto"] === "https" || request.protocol === "https"
                  ? "https"
                  : "http",
            },
          }) as unknown as globalThis.WebSocket,
      ),
    );
    const client = yield* request.upgrade;
    const upstreamReader = yield* upstream.reader;
    const upstreamWriter = yield* upstream.writer;
    const clientReader = yield* client.reader;
    const clientWriter = yield* client.writer;
    const pump = (reader: Socket.Reader, writer: Socket.Writer) =>
      Effect.forever(reader.pull.pipe(Effect.flatMap(writer.writeAll)));
    yield* Effect.raceFirst(
      pump(upstreamReader, clientWriter),
      pump(clientReader, upstreamWriter),
    ).pipe(Effect.ignoreCause);
    return HttpServerResponse.empty();
  }).pipe(
    Effect.scoped,
    Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 400 })),
  ),
).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal));
