// @effect-diagnostics nodeBuiltinImport:off -- SEA 通过 createRequire 加载磁盘上的 undici。
import * as NodeModule from "node:module";

import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import type { ClaudeSettings } from "@murmur/contracts";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/http";
import type * as Undici from "undici";

const requireUndici = NodeModule.createRequire(import.meta.url);

export const makeClaudeHttpClient = Effect.fn("ClaudeHttpClient.make")(function* (
  config: Pick<ClaudeSettings, "httpProxy">,
  environment: NodeJS.ProcessEnv,
  options: { readonly followRedirects?: boolean } = {},
) {
  const httpProxy = config.httpProxy?.trim();
  if (!httpProxy) return yield* HttpClient.HttpClient;

  const dispatcher = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const undici = requireUndici("undici") as typeof Undici;
      return new undici.EnvHttpProxyAgent({
        httpProxy,
        httpsProxy: httpProxy,
        noProxy: environment.no_proxy ?? environment.NO_PROXY ?? "localhost,127.0.0.1,::1",
        allowH2: false,
        // HTTPS 代理的默认 connector 会忽略 allowH2，需同时固定连接池协议。
        clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
      });
    }),
    (dispatcher) => Effect.promise(() => dispatcher.destroy()),
  );
  return yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, dispatcher),
    Effect.map((client) =>
      options.followRedirects === false ? client : HttpClient.followRedirects(client),
    ),
  );
});
