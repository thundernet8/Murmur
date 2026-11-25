import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";

import { makeAntigravityUsageProbe } from "./antigravityUsageLimits.ts";

describe("Antigravity subscription limits", () => {
  it.effect("禁用额度探针，不依赖凭据、文件系统或 HTTP 服务", () =>
    Effect.gen(function* () {
      const checkedAt = "2026-11-25T00:00:00.000Z";
      yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(checkedAt)));
      const usage = yield* makeAntigravityUsageProbe();
      const limits = yield* usage.probe;
      expect(limits).toMatchObject({
        checkedAt,
        windows: [],
        unavailable: { reason: "unsupported" },
      });
      expect(limits.credentialFingerprint).toBeUndefined();
      yield* usage.clear;
      expect(yield* usage.probe).toEqual(limits);
    }),
  );
});
