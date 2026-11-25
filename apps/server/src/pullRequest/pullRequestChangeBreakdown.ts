import type { PullRequestChangeBreakdown } from "@murmur/contracts";
import { summarizeChangedFiles } from "@murmur/shared/changedFileKind";
import type { ProviderFileStats } from "@murmur/source-control-core/server/PullRequestProvider";

export function toChangeBreakdown(stats: ProviderFileStats): PullRequestChangeBreakdown {
  if (stats.truncated) return null;
  return summarizeChangedFiles(stats.files);
}
