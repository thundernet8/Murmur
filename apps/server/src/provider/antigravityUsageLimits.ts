import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { makeUnavailableUsageLimits } from "@t3tools/provider-core/server/usageLimits";

// 提取或复用 agy 的 OAuth 凭据访问 Google API 存在违反 ToS 的风险，禁止额度直连及反代。
// https://antigravity.google/terms §6；额度信息只能通过官方 CLI/ACP 获取。
export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(() =>
  Effect.succeed({
    probe: DateTime.now.pipe(
      Effect.map((now) =>
        makeUnavailableUsageLimits({
          checkedAt: DateTime.formatIso(now),
          reason: "unsupported",
        }),
      ),
    ),
    clear: Effect.void,
  }),
);
