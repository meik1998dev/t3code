import type { OrchestrationThread, ThreadId } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { createEnvironmentCommand } from "./runtime.ts";
import { ThreadSnapshotLoader } from "./threadSnapshotHttp.ts";

export class FullThreadHistoryError extends Data.TaggedError("FullThreadHistoryError")<{
  readonly message: string;
}> {}

/**
 * Command that fetches a complete thread over HTTP with no turn window. Fork
 * and "copy transcript" need every message once, so this bypasses the paged
 * thread store instead of loading every older page into it and keeping them
 * resident.
 */
export function createFullThreadHistoryCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | ThreadSnapshotLoader | R, E>,
) {
  return createEnvironmentCommand(runtime, {
    label: "environment-data:threads:full-snapshot",
    execute: (threadId: ThreadId) =>
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        const prepared = yield* SubscriptionRef.get(supervisor.prepared);
        if (Option.isNone(prepared)) {
          return yield* new FullThreadHistoryError({
            message: "Reconnect the environment to load this chat's history.",
          });
        }
        const loader = yield* ThreadSnapshotLoader;
        const snapshot = yield* loader.load(prepared.value, threadId);
        if (Option.isNone(snapshot)) {
          return yield* new FullThreadHistoryError({
            message: "Could not load the full chat history.",
          });
        }
        return snapshot.value.thread satisfies OrchestrationThread;
      }),
  });
}
