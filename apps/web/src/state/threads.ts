import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentThreadDetailAtoms,
  createEnvironmentThreadShellAtoms,
  createEnvironmentThreadStateAtoms,
  EMPTY_ENVIRONMENT_THREAD_STATE,
  requestOlderThreadTurns,
  threadHasOlderTurns,
  type EnvironmentThreadState,
  createThreadEnvironmentAtoms,
} from "@t3tools/client-runtime/state/threads";
import type {
  EnvironmentId,
  OrchestrationThread,
  ScopedThreadRef,
  ThreadId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
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

function readEnvironmentThreadState(threadRef: ScopedThreadRef): EnvironmentThreadState {
  const result = appAtomRegistry.get(
    environmentThreads.stateAtom(threadRef.environmentId, threadRef.threadId),
  );
  return Option.getOrElse(
    AsyncResult.value(result),
    () => EMPTY_ENVIRONMENT_THREAD_STATE,
  ) as EnvironmentThreadState;
}

function waitForOlderThreadPage(
  threadRef: ScopedThreadRef,
  beforeCursor: string | null,
  timeoutMs: number,
): Promise<EnvironmentThreadState> {
  const atom = environmentThreads.stateAtom(threadRef.environmentId, threadRef.threadId);
  const readResult = () => appAtomRegistry.get(atom);

  return new Promise((resolve, reject) => {
    let requestStarted = false;
    let settled = false;
    let unsubscribe = () => {};
    const timeout = globalThis.setTimeout(() => {
      unsubscribe();
      reject(new Error("Timed out while loading the full chat history."));
    }, timeoutMs);
    const finish = (result: EnvironmentThreadState | Error) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout(timeout);
      unsubscribe();
      if (result instanceof Error) reject(result);
      else resolve(result);
    };
    const check = (result: ReturnType<typeof readResult>) => {
      if (!requestStarted) return;
      const state = Option.getOrElse(
        AsyncResult.value(result),
        () => EMPTY_ENVIRONMENT_THREAD_STATE,
      ) as EnvironmentThreadState;
      if (Option.isSome(state.error)) {
        finish(new Error(state.error.value));
        return;
      }
      const page = Option.getOrNull(state.page);
      if (page === null || !page.hasMore || page.beforeCursor !== beforeCursor) {
        finish(state);
      }
    };

    unsubscribe = appAtomRegistry.subscribe(atom, check);
    requestStarted = true;
    const requested = requestOlderThreadTurns(threadRef.environmentId, threadRef.threadId);
    const current = readEnvironmentThreadState(threadRef);
    const currentPage = Option.getOrNull(current.page);
    if (!requested && currentPage?.loadingOlder !== true && threadHasOlderTurns(current)) {
      finish(new Error("Could not load the full chat history."));
      return;
    }
    check(readResult());
  });
}

/** Loads every older page and returns the complete thread snapshot. */
export async function loadFullThreadHistory(
  threadRef: ScopedThreadRef,
  pageTimeoutMs = 30_000,
): Promise<OrchestrationThread> {
  let state = readEnvironmentThreadState(threadRef);
  const seenCursors = new Set<string | null>();

  while (threadHasOlderTurns(state)) {
    const cursor = Option.getOrThrow(state.page).beforeCursor;
    if (seenCursors.has(cursor)) {
      throw new Error("The chat history cursor did not advance.");
    }
    seenCursors.add(cursor);
    state = await waitForOlderThreadPage(threadRef, cursor, pageTimeoutMs);
  }

  return Option.getOrThrowWith(state.data, () => new Error("The chat history is not available."));
}
