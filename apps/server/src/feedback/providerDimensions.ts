import type { ModelSelection, ServerProvider } from "@murmur/contracts";

import { BUNDLED_MODEL_MANIFEST } from "../provider/ModelManifest.ts";

export interface ProviderDimensions {
  readonly provider: string;
  readonly model?: string;
}

export function providerDimensions(
  providers: ReadonlyArray<ServerProvider>,
  selection: Pick<ModelSelection, "instanceId" | "model">,
): ProviderDimensions {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (provider === undefined) return { provider: "unknown" };
  return { provider: provider.driver, model: modelLabel(providers, selection.model) };
}

const DATED_SNAPSHOT = /-\d{8}$/u;
const FILE_PATH = /^(?:[/~]|\.{1,2}[/\\]|[A-Za-z]:[\\/])|\\/u;

const fileName = (model: string) =>
  FILE_PATH.test(model) ? model.slice(model.search(/[^/\\]*$/u)) : model;

const MANIFEST_LABELS: ReadonlyMap<string, string> = new Map(
  Object.values(BUNDLED_MODEL_MANIFEST.providers ?? {}).flatMap((catalog) =>
    catalog.models.flatMap((model) =>
      [model.slug, ...(model.aliases ?? [])].map((name) => [name, model.slug] as const),
    ),
  ),
);

export function modelLabel(providers: ReadonlyArray<ServerProvider>, model: string): string {
  return fileName(catalogSlug(providers, model) ?? model);
}

function catalogSlug(providers: ReadonlyArray<ServerProvider>, model: string) {
  const leaf = model.slice(model.lastIndexOf("/") + 1);
  const candidates = [model, leaf, leaf.replace(DATED_SNAPSHOT, "")];
  for (const candidate of candidates) {
    const label = MANIFEST_LABELS.get(candidate);
    if (label !== undefined) return label;
  }
  for (const provider of providers) {
    const match = provider.models.find(
      (entry) =>
        candidates.includes(entry.slug) ||
        entry.aliases?.some((alias) => candidates.includes(alias)) === true,
    );
    if (match !== undefined) return match.slug;
  }
  return undefined;
}
