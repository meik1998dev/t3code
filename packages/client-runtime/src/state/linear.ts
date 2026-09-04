import { WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/**
 * Linear reads and the one write (storing the API key). Status and the issue
 * list are cached queries; picking an issue is a command so the composer
 * fetches the full text exactly once per pick.
 */
export function createLinearEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const commandScheduler = createAtomCommandScheduler();
  const status = createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:linear:status",
    tag: WS_METHODS.linearGetStatus,
    staleTimeMs: 5 * 60_000,
  });
  return {
    status,
    myIssues: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:linear:my-issues",
      tag: WS_METHODS.linearListMyIssues,
      staleTimeMs: 60_000,
    }),
    getIssue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:get-issue",
      tag: WS_METHODS.linearGetIssue,
      scheduler: commandScheduler,
    }),
    setApiKey: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:linear:set-api-key",
      tag: WS_METHODS.linearSetApiKey,
      scheduler: commandScheduler,
      concurrency: {
        mode: "serial",
        key: ({ environmentId }) => environmentId,
      },
      // The key changed, so the "connected as" line and the issue list must reload.
      onSettled: (target, registry) =>
        Effect.sync(() => {
          registry.refresh(status({ environmentId: target.environmentId, input: {} }));
        }),
    }),
  };
}
