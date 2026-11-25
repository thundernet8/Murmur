#!/usr/bin/env node

import * as Effect from "effect/Effect";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { exportBrandIcons } from "./export-brand-icons.ts";

if (import.meta.main) {
  exportBrandIcons(false).pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
}
