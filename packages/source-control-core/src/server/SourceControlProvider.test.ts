import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:T3Tools/murmur.git", "T3Tools/murmur"],
  ["github.com:T3Tools/murmur.git", "T3Tools/murmur"],
  ["gitlab.com:T3Tools/platform/murmur", "T3Tools/platform/murmur"],
  ["https://github.com/T3Tools/t3code.git", "T3Tools/murmur"],
  ["https://github.com/T3Tools/t3code.git?view=compact", "T3Tools/murmur"],
  ["https://github.com/T3Tools/t3code.git#section", "T3Tools/murmur"],
  ["C:/repos/murmur", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
