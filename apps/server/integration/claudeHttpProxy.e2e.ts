// @effect-diagnostics nodeBuiltinImport:off -- 此 E2E 通过本机 HTTP/TLS 服务验证真实代理传输，不访问外网。
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeNet from "node:net";

import * as NodePath from "@effect/platform-node/NodePath";
import { ProviderDriverKind, ProviderInstanceId } from "@murmur/contracts";
import * as SecretResolver from "@murmur/secret-provider-core/server/SecretResolver";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HostProcess from "@murmur/shared/HostProcess";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import * as Undici from "undici";
import { expect, it } from "vite-plus/test";

import { makeClaudeHttpClient } from "../src/provider/Drivers/ClaudeHttpClient.ts";
import {
  readClaudeResetCredits,
  consumeClaudeResetCredit,
} from "../src/provider/claudeResetCredits.ts";
import * as ServerSettings from "../src/serverSettings.ts";
import * as TextGenerators from "../src/textGeneration/TextGenerators.ts";

const listen = async (server: NodeHttp.Server | NodeHttps.Server) => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("缺少本机测试服务端口");
  return address.port;
};

it("Claude 官方请求使用实例代理，保留绕过规则，并随实例释放连接", async () => {
  const requests: Array<{
    method: string;
    path: string;
    authorization: string;
    body: string;
    apiKey?: string;
  }> = [];
  const handleRequest: NodeHttp.RequestListener = async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({
      method: request.method ?? "",
      path: request.url ?? "",
      authorization: request.headers.authorization ?? "",
      body,
      ...(typeof request.headers["x-api-key"] === "string"
        ? { apiKey: request.headers["x-api-key"] }
        : {}),
    });
    if (request.url?.startsWith("/redirect/models")) {
      response.writeHead(302, { location: "/captured-key" }).end();
      return;
    }
    if (request.url?.startsWith("/v1/")) {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify(
          request.method === "POST"
            ? {
                stop_reason: "end_turn",
                content: [{ type: "text", text: '{"title":"Proxy title"}' }],
              }
            : { data: [{ id: "claude-test" }] },
        ),
      );
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify(
        request.method === "POST"
          ? { result: "reset" }
          : {
              cedar_ember: {
                eligible: true,
                next_grant_id: "test",
                grants: [{ id: "test", resets_left: 1, usable_now: true }],
              },
            },
      ),
    );
  };
  const origin = NodeHttp.createServer(handleRequest);
  const secureOrigin = NodeHttps.createServer(
    {
      key: await NodeFSP.readFile(
        new URL("../src/peer/fixtures/localhost-key.pem", import.meta.url),
      ),
      cert: await NodeFSP.readFile(
        new URL("../src/peer/fixtures/localhost-cert.pem", import.meta.url),
      ),
    },
    handleRequest,
  );
  const connections: string[] = [];
  const sockets = new Set<NodeNet.Socket>();
  let refuseTunnel = false;
  const makeProxy = (name: string) => {
    const proxy = NodeHttp.createServer((request, response) => {
      connections.push(`${name} ${request.url}`);
      if (request.url?.endsWith("/redirect")) {
        response.writeHead(302, { location: "/final" }).end();
      } else {
        response.end(name);
      }
    });
    proxy.on("connect", (request, socket, head) => {
      connections.push(`${name} CONNECT ${request.url}`);
      if (refuseTunnel || request.url !== `localhost:${securePort}`) {
        socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        return;
      }
      const upstream = NodeNet.connect(securePort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
      socket.on("error", () => upstream.destroy());
    });
    proxy.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    return proxy;
  };
  const proxyA = makeProxy("a");
  const proxyB = makeProxy("b");
  const shared = HttpClient.make(() => Effect.die("代理请求不得回退到共享客户端"));
  const globalDispatcher = Undici.getGlobalDispatcher();
  let securePort = 0;
  try {
    const port = await listen(origin);
    securePort = await listen(secureOrigin);
    const addressA = `http://127.0.0.1:${await listen(proxyA)}`;
    const addressB = `http://127.0.0.1:${await listen(proxyB)}`;
    const disposed = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          for (const config of [{}, { httpProxy: "" }]) {
            expect(yield* makeClaudeHttpClient(config, {})).toBe(shared);
          }
          const a = yield* makeClaudeHttpClient({ httpProxy: addressA }, { NO_PROXY: "" });
          const b = yield* makeClaudeHttpClient({ httpProxy: addressB }, { NO_PROXY: "" });
          expect(
            yield* a.get("http://claude.invalid/redirect").pipe(Effect.flatMap((r) => r.text)),
          ).toBe("a");
          expect(
            yield* b.get("http://claude.invalid/usage").pipe(Effect.flatMap((r) => r.text)),
          ).toBe("b");
          expect(connections).toEqual([
            "a http://claude.invalid/redirect",
            "a http://claude.invalid/final",
            "b http://claude.invalid/usage",
          ]);
          for (const environment of [
            { NO_PROXY: "localhost,127.0.0.1,::1" },
            { NO_PROXY: "", no_proxy: "127.0.0.1" },
          ]) {
            const direct = yield* makeClaudeHttpClient({ httpProxy: addressA }, environment);
            const response = yield* direct.get(`http://127.0.0.1:${port}/bypass`);
            yield* response.text;
            expect(connections).toHaveLength(3);
          }
          const override = yield* makeClaudeHttpClient(
            { httpProxy: addressA },
            { NO_PROXY: "*", no_proxy: "" },
          );
          expect(
            yield* override
              .get(`http://127.0.0.1:${port}/proxy`)
              .pipe(Effect.flatMap((r) => r.text)),
          ).toBe("a");
          const official = a.pipe(
            HttpClient.mapRequest((request) =>
              HttpClientRequest.setUrl(
                request,
                `https://localhost:${securePort}${new URL(request.url).pathname}`,
              ),
            ),
          );
          const fs = FileSystem.makeNoop({
            readFileString: (file) =>
              Effect.succeed(
                JSON.stringify(
                  file.endsWith(".credentials.json")
                    ? { claudeAiOauth: { accessToken: "test-token" } }
                    : { oauthAccount: { organizationUuid: "test-org" } },
                ),
              ),
          });
          const credits = yield* readClaudeResetCredits("/test-config", "2.1.0").pipe(
            Effect.provideService(HttpClient.HttpClient, official),
            Effect.provideService(FileSystem.FileSystem, fs),
            Effect.provideService(HostProcess.Platform, "linux"),
          );
          expect(credits?.availableCount).toBe(1);
          expect(
            yield* consumeClaudeResetCredit({
              configDir: "/test-config",
              accountConfigPath: "/test-config/.claude.json",
              version: "2.1.0",
              grantId: "test",
              requestId: "test-request",
            }).pipe(
              Effect.provideService(HttpClient.HttpClient, official),
              Effect.provideService(FileSystem.FileSystem, fs),
              Effect.provideService(HostProcess.Platform, "linux"),
            ),
          ).toBe("reset");
          expect(connections).toContain(`a CONNECT localhost:${securePort}`);
          expect(requests.slice(-2)).toEqual([
            {
              method: "GET",
              path: "/api/oauth/usage?cedar_ember=1&skip_spend=1",
              authorization: "Bearer test-token",
              body: "",
            },
            {
              method: "POST",
              path: "/api/organizations/test-org/reset_rate_limits",
              authorization: "Bearer test-token",
              body: '{"program":"cedar_ember","grant_id":"test","request_id":"test-request"}',
            },
          ]);
          const generatorId = ProviderInstanceId.make("anthropic-api");
          const defaultClaudeId = ProviderInstanceId.make("claudeAgent");
          const claudeDriver = ProviderDriverKind.make("claudeAgent");
          const generatorConfig = {
            kind: "anthropic",
            baseUrl: `https://localhost:${securePort}/v1`,
            apiKey: "generator-key",
            enabled: true,
          } as const;
          const fallbackRequests: string[] = [];
          const generatorFallback = HttpClient.make((request) => {
            fallbackRequests.push(request.url);
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json({ data: [{ id: "shared-model" }] }),
              ),
            );
          });
          const generatorLayer = Layer.effect(
            TextGenerators.TextGenerators,
            TextGenerators.make,
          ).pipe(
            Layer.provideMerge(
              ServerSettings.layerTest({
                providerInstances: {
                  [ProviderInstanceId.make("claude_work")]: {
                    driver: claudeDriver,
                    config: { httpProxy: addressB },
                  },
                  [defaultClaudeId]: {
                    driver: claudeDriver,
                    config: { httpProxy: addressA },
                    environment: [{ name: "NO_PROXY", value: "", sensitive: false }],
                  },
                },
                textGenerators: { [generatorId]: generatorConfig },
              }),
            ),
            Layer.provide(Layer.mock(SecretResolver.SecretResolver)({})),
            Layer.provide(Layer.succeed(HttpClient.HttpClient, generatorFallback)),
          );
          yield* Effect.gen(function* () {
            const generators = yield* TextGenerators.TextGenerators;
            const settings = yield* ServerSettings.ServerSettingsService;
            const before = connections.length;
            const tested = yield* generators.listModels({ id: generatorId, test: true });
            expect(tested.testedModel).toBe("claude-test");
            expect(connections.slice(before)).toContain(`a CONNECT localhost:${securePort}`);
            expect(
              connections
                .slice(before)
                .every((connection) => connection === `a CONNECT localhost:${securePort}`),
            ).toBe(true);
            expect(requests.at(-1)?.apiKey).toBe("generator-key");
            const run = yield* generators.runner(generatorId);
            const generation = {
              operation: "generateThreadTitle",
              cwd: "/unused",
              prompt: "Name this thread.",
              outputSchema: Schema.Struct({ title: Schema.String }),
              modelSelection: { instanceId: generatorId, model: "claude-test" },
            } as const;
            expect(yield* run!(generation)).toEqual({ title: "Proxy title" });
            yield* settings.updateSettings({
              providerInstances: {
                [defaultClaudeId]: {
                  driver: claudeDriver,
                  config: { httpProxy: addressB },
                  environment: [{ name: "NO_PROXY", value: "", sensitive: false }],
                },
              },
            });
            const changed = connections.length;
            expect(yield* run!(generation)).toEqual({ title: "Proxy title" });
            expect(connections.slice(changed)).toEqual([`b CONNECT localhost:${securePort}`]);
            yield* settings.updateSettings({
              providerInstances: {
                [defaultClaudeId]: {
                  driver: claudeDriver,
                  config: { httpProxy: addressA },
                  environment: [{ name: "no_proxy", value: "localhost", sensitive: false }],
                },
              },
            });
            const bypass = connections.length;
            yield* generators.listModels({ id: generatorId, refresh: true });
            expect(connections).toHaveLength(bypass);
            const beforeRedirect = requests.length;
            expect(
              (yield* generators
                .listModels({
                  id: generatorId,
                  config: {
                    ...generatorConfig,
                    baseUrl: `https://localhost:${securePort}/redirect`,
                  },
                })
                .pipe(Effect.result))._tag,
            ).toBe("Failure");
            expect(requests).toHaveLength(beforeRedirect + 1);
            expect(requests.at(-1)?.path).toBe("/redirect/models?limit=1000");
            expect(requests.some((request) => request.path === "/captured-key")).toBe(false);
            yield* generators.listModels({
              id: generatorId,
              config: {
                kind: "openaiCompatible",
                baseUrl: "https://openai.invalid/v1",
                apiKey: "other-key",
                enabled: true,
              },
            });
            expect(fallbackRequests).toEqual(["https://openai.invalid/v1/models"]);
            yield* settings.updateSettings({
              providerInstances: {
                [defaultClaudeId]: { driver: claudeDriver, config: { httpProxy: "" } },
              },
            });
            expect(
              (yield* generators.listModels({ id: generatorId, refresh: true })).models,
            ).toEqual([{ id: "shared-model", name: "shared-model" }]);
            expect(fallbackRequests).toHaveLength(2);
          }).pipe(Effect.provide(generatorLayer));
          refuseTunnel = true;
          const requestCount = requests.length;
          expect(
            (yield* a.get(`https://127.0.0.1:${securePort}/refused`).pipe(Effect.result))._tag,
          ).toBe("Failure");
          expect(requests).toHaveLength(requestCount);
          expect(Undici.getGlobalDispatcher()).toBe(globalDispatcher);
          return a;
        }).pipe(
          Effect.provideService(HttpClient.HttpClient, shared),
          Effect.provide(NodePath.layer),
        ),
      ),
    );
    expect(
      (await Effect.runPromise(disposed.get("http://claude.invalid/closed").pipe(Effect.result)))
        ._tag,
    ).toBe("Failure");
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all(
      [origin, secureOrigin, proxyA, proxyB].map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            if (!server.listening) return resolve();
            server.close((error) => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
    );
  }
});
