import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
  ThreadSnapshotLoader,
} from "@t3tools/client-runtime/state/threads";
import { EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import {
  createEnvironmentCommand,
  runAtomCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  OrchestrationThread,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSnapshotAtom } from "./shell";
import { appAtomRegistry } from "../rpc/atomRegistry";

export const threadEnvironment = createThreadEnvironmentAtoms(connectionAtomRuntime);
export const environmentThreads = createEnvironmentThreadStateAtoms(connectionAtomRuntime);
export const environmentThreadDetails = createEnvironmentThreadDetailAtoms(
  environmentThreads.stateAtom,
);
export const environmentThreadShells = createEnvironmentThreadShellAtoms({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  snapshotAtom: environmentSnapshotAtom,
});

const EMPTY_THREAD_STATE_ATOM = Atom.make(AsyncResult.success(EMPTY_ENVIRONMENT_THREAD_STATE)).pipe(
  Atom.withLabel("web-environment-thread:empty"),
);

export function useEnvironmentThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): EnvironmentThreadState {
  const result = useAtomValue(
    environmentId !== null && threadId !== null
      ? environmentThreads.stateAtom(environmentId, threadId)
      : EMPTY_THREAD_STATE_ATOM,
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

class FullThreadHistoryError extends Data.TaggedError("FullThreadHistoryError")<{
  readonly message: string;
}> {}

const fullThreadSnapshotCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "environment-data:threads:full-snapshot",
  execute: (threadId: ThreadId) =>
    Effect.gen(function* () {
      const supervisor = yield* EnvironmentSupervisor;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) {
        return yield* new FullThreadHistoryError({
          message: "Reconnect the environment before forking this chat.",
        });
      }
      const loader = yield* ThreadSnapshotLoader;
      const snapshot = yield* loader.load(prepared.value, threadId);
      if (Option.isNone(snapshot)) {
        return yield* new FullThreadHistoryError({
          message: "Could not load the full chat history.",
        });
      }
      return snapshot.value.thread;
    }),
});

/**
 * Fetches the complete thread over HTTP with no turn window. Fork needs every
 * message once, so this bypasses the paged thread store instead of loading
 * every older page into it and keeping them resident.
 */
export async function loadFullThreadHistory(
  threadRef: ScopedThreadRef,
): Promise<OrchestrationThread> {
  const result = await runAtomCommand(
    appAtomRegistry,
    fullThreadSnapshotCommand,
    { environmentId: threadRef.environmentId, input: threadRef.threadId },
    { reportFailure: false },
  );
  if (result._tag === "Failure") {
    throw squashAtomCommandFailure(result);
  }
  return result.value;
}
