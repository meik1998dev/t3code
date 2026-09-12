import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

/** Polling cadence while the ports popover is open. */
export const AGENT_PORTS_REFRESH_INTERVAL_MS = 4_000;

/**
 * Listening ports that agent sessions opened on one environment. The query is
 * only subscribed while the popover is open, so the 4 s refresh costs nothing
 * the rest of the time.
 */
export function createAgentPortsEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    list: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:agent-ports:list",
      tag: WS_METHODS.agentPortsList,
      staleTimeMs: AGENT_PORTS_REFRESH_INTERVAL_MS,
      refreshIntervalMs: AGENT_PORTS_REFRESH_INTERVAL_MS,
    }),
  };
}
