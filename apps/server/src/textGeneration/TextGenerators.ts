import {
  ClaudeSettings,
  type ListTextGeneratorModelsInput,
  type ListTextGeneratorModelsResult,
  ProviderInstanceId,
  TextGenerationError,
  type TextGeneratorConfig,
  TextGeneratorError,
  type TextGeneratorModel,
  textGeneratorForSelection,
} from "@murmur/contracts";
import * as TextGenerationOperations from "@murmur/provider-core/server/textGenerationOperations";
import { mergeProviderInstanceEnvironment } from "@murmur/provider-core/server/instanceEnvironment";
import * as SecretResolver from "@murmur/secret-provider-core/server/SecretResolver";
import * as HostProcess from "@murmur/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Equal from "effect/Equal";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as SecretResolverLayer from "../secrets/SecretResolver.ts";
import { requireSettingsSecret } from "../secrets/settingsSecretValue.ts";
import * as ServerSettings from "../serverSettings.ts";
import { SECRET_REDACTED } from "../settingsSecrets.ts";
import { makeClaudeHttpClient } from "../provider/Drivers/ClaudeHttpClient.ts";
import {
  TEXT_GENERATOR_DRIVERS,
  type TextGeneratorConnection,
  TextGeneratorRequestError,
} from "./textGeneratorDrivers.ts";

const decodeClaudeSettings = Schema.decodeUnknownEffect(ClaudeSettings);

/** Text generators configured in settings: model APIs that generate text but cannot run agents. */
export class TextGenerators extends Context.Service<
  TextGenerators,
  {
    /** The runner for a text generator id, or undefined when the id names no text generator. */
    readonly runner: (
      id: ProviderInstanceId,
    ) => Effect.Effect<TextGenerationOperations.Runner | undefined>;
    readonly listModels: (
      input: ListTextGeneratorModelsInput,
    ) => Effect.Effect<ListTextGeneratorModelsResult, TextGeneratorError>;
  }
>()("t3/textGeneration/TextGenerators") {}

interface CachedModels {
  readonly config: TextGeneratorConfig;
  readonly models: ReadonlyArray<TextGeneratorModel>;
}

/** The generator's name for messages: its label, else the host it reaches. */
const generatorLabel = (config: TextGeneratorConfig) => {
  if (config.label) return config.label;
  try {
    return new URL(config.baseUrl).host;
  } catch {
    return "The model API";
  }
};

/** @public */
export const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* SecretResolver.SecretResolver;
  const http = yield* HttpClient.HttpClient;
  const modelCache = yield* Ref.make(new Map<ProviderInstanceId, CachedModels>());
  // Settings already drop saved generators under an allow-list; this stops unsaved ones too.
  const allowListed =
    settingsService.managedPolicy?.limits?.providers?.allowedDrivers !== undefined;

  const readConfig = Effect.fn("TextGenerators.readConfig")(function* (id: ProviderInstanceId) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        () =>
          new TextGeneratorRequestError({ detail: "Couldn't read this environment's settings." }),
      ),
    );
    return textGeneratorForSelection(settings, id);
  });

  const connect = Effect.fn("TextGenerators.connect")(function* (config: TextGeneratorConfig) {
    const label = generatorLabel(config);
    const apiKey = yield* requireSettingsSecret(secrets, config.apiKey).pipe(
      Effect.mapError((cause) => new TextGeneratorRequestError({ detail: cause.message, cause })),
    );
    return { baseUrl: config.baseUrl, apiKey, label } satisfies TextGeneratorConnection;
  });

  const clientFor = Effect.fn("TextGenerators.clientFor")(function* (config: TextGeneratorConfig) {
    if (config.kind !== "anthropic") return http;
    const settings = yield* settingsService.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new TextGeneratorRequestError({
            detail: "Couldn't read Claude proxy settings.",
            cause,
          }),
      ),
    );
    // Text Generator 没有关联的 agent 实例，只继承同一环境默认 Claude 实例的代理。
    const instance = settings.providerInstances[ProviderInstanceId.make("claudeAgent")];
    if (instance?.driver !== "claudeAgent") return http;
    const claude = yield* decodeClaudeSettings(instance.config ?? {}).pipe(
      Effect.mapError(
        (cause) =>
          new TextGeneratorRequestError({
            detail: "Claude proxy settings are invalid.",
            cause,
          }),
      ),
    );
    if (!claude.httpProxy) return http;
    const bypass = yield* Effect.forEach(
      (instance.environment ?? []).filter((variable) => variable.name.toUpperCase() === "NO_PROXY"),
      (variable) =>
        requireSettingsSecret(secrets, variable.value).pipe(
          Effect.map((value) => ({ ...variable, value })),
          Effect.mapError(
            (cause) =>
              new TextGeneratorRequestError({
                detail: "Couldn't read Claude proxy settings.",
                cause,
              }),
          ),
        ),
    );
    const environment = yield* mergeProviderInstanceEnvironment(
      bypass,
      yield* HostProcess.Environment,
    );
    return yield* makeClaudeHttpClient(claude, environment, { followRedirects: false }).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
  });

  const runnerFor =
    (config: TextGeneratorConfig): TextGenerationOperations.Runner =>
    (request) => {
      const driver = TEXT_GENERATOR_DRIVERS[config.kind];
      const label = generatorLabel(config);
      return Effect.gen(function* () {
        const connection = yield* connect(config);
        const client = yield* clientFor(config);
        return yield* driver
          .generate(connection, request.modelSelection.model, request.prompt)
          .pipe(Effect.provideService(HttpClient.HttpClient, client));
      }).pipe(
        Effect.scoped,
        Effect.mapError(
          (error) =>
            new TextGenerationError({
              operation: request.operation,
              detail: error.detail,
              cause: error,
            }),
        ),
        Effect.flatMap((text) => TextGenerationOperations.decodeJsonReply(request, label, text)),
      );
    };

  const runner = Effect.fn("TextGenerators.runner")(function* (id: ProviderInstanceId) {
    const config = yield* readConfig(id).pipe(Effect.orElseSucceed(() => undefined));
    if (config === undefined) return undefined;
    const label = generatorLabel(config);
    if (!config.enabled) {
      return ((request) =>
        Effect.fail(
          new TextGenerationError({
            operation: request.operation,
            detail: `${label} is off. Turn it on in Settings → Providers.`,
          }),
        )) satisfies TextGenerationOperations.Runner;
    }
    return TextGenerationOperations.withoutInvestigation(label, runnerFor(config));
  });

  const listModels = Effect.fn("TextGenerators.listModels")(
    function* (input: ListTextGeneratorModelsInput) {
      if (allowListed) {
        return yield* new TextGeneratorRequestError({
          detail: "Your organization's provider policy turns off text generators.",
        });
      }
      const saved = yield* readConfig(input.id);
      const config =
        input.config === undefined
          ? saved
          : input.config.apiKey === SECRET_REDACTED
            ? // The saved key goes only to the endpoint it was saved for.
              {
                ...input.config,
                apiKey: saved?.baseUrl === input.config.baseUrl ? saved.apiKey : "",
              }
            : input.config;
      if (config === undefined) {
        return yield* new TextGeneratorRequestError({
          detail: "That text generator no longer exists.",
        });
      }
      // Checking unsaved settings, or testing, must reach the API rather than trust the cache.
      const fresh = input.config !== undefined || input.test === true;
      const cached = (yield* Ref.get(modelCache)).get(input.id);
      // Keyed on the whole config so a changed URL or key never serves another API's list.
      if (
        !fresh &&
        input.refresh !== true &&
        cached !== undefined &&
        Equal.equals(cached.config, config)
      ) {
        return { models: cached.models };
      }
      const connection = yield* connect(config);
      const client = yield* clientFor(config);
      const driver = TEXT_GENERATOR_DRIVERS[config.kind];
      const models = yield* driver
        .listModels(connection)
        .pipe(Effect.provideService(HttpClient.HttpClient, client));
      if (input.test === true) {
        // An explicit test sends one tiny request: some APIs list models without checking the key.
        const model =
          input.model ??
          (models.find((candidate) => /haiku|mini|flash|nano/i.test(candidate.id)) ?? models[0])
            ?.id;
        if (model === undefined) {
          return yield* new TextGeneratorRequestError({
            detail: `${connection.label} lists no models to test with.`,
          });
        }
        yield* driver
          .generate(connection, model, "Reply with OK.")
          .pipe(Effect.provideService(HttpClient.HttpClient, client));
        return { models, testedModel: model };
      }
      yield* Ref.update(modelCache, (current) =>
        new Map(current).set(input.id, { config, models }),
      );
      return { models };
    },
    Effect.scoped,
    Effect.mapError((error) => new TextGeneratorError({ detail: error.detail })),
  );

  return TextGenerators.of({ runner, listModels });
});

export const layer = Layer.effect(TextGenerators, make).pipe(
  Layer.provide([SecretResolverLayer.layer, FetchHttpClient.layer]),
);
