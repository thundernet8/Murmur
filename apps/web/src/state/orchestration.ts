import { ORCHESTRATION_V2_WS_METHODS } from "@murmur/contracts";
import { createOrchestrationEnvironmentAtoms } from "@murmur/client-runtime/state/orchestration";
import { createEnvironmentRpcCommand } from "@murmur/client-runtime/state/runtime";

import { connectionAtomRuntime } from "../connection/runtime";
import { environmentShell } from "./shell";

export const orchestrationEnvironment = createOrchestrationEnvironmentAtoms(connectionAtomRuntime, {
  shellState: environmentShell.stateValueAtom,
});

export const threadTitlesRead = createEnvironmentRpcCommand(connectionAtomRuntime, {
  label: "environment-data:orchestration:thread-titles-read",
  tag: ORCHESTRATION_V2_WS_METHODS.getThreadTitles,
});
