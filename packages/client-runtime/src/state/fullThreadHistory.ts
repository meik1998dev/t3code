import type { OrchestrationV2ThreadProjection, ThreadId } from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";

import * as RemoteEnvironmentAuthorization from "../authorization/service.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { PreparedConnection } from "../connection/model.ts";
import * as ManagedRelay from "../relay/managedRelay.ts";
import {
  executeAuthenticatedEnvironmentHttpRequest,
  withOrchestrationProtocolHeader,
} from "./environmentHttpAuth.ts";
import { createEnvironmentCommand } from "./runtime.ts";

// Long enough for a slow but alive server to finish; a cold open has no fallback for older pages.
const DEFAULT_FULL_THREAD_SNAPSHOT_TIMEOUT_MS = 20_000;

class FullThreadHistoryError extends Data.TaggedError("FullThreadHistoryError")<{
  readonly message: string;
}> {}

const fetchFullThreadSnapshot = Effect.fn("fullThreadHistory.fetchSnapshot")(function* (input: {
  readonly prepared: PreparedConnection;
  readonly threadId: ThreadId;
  readonly signer: Option.Option<ManagedRelay.ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<
    RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization["Service"]
  >;
  readonly timeoutMs?: number;
}) {
  return yield* executeAuthenticatedEnvironmentHttpRequest({
    ...input,
    group: "orchestration",
    method: "GET",
    url: (urls) => urls.threadSnapshot({ params: { threadId: input.threadId } }),
    timeoutMs: input.timeoutMs ?? DEFAULT_FULL_THREAD_SNAPSHOT_TIMEOUT_MS,
    request: ({ client, headers }) =>
      client.threadSnapshot({
        params: { threadId: input.threadId },
        headers: withOrchestrationProtocolHeader(headers),
      }),
  });
});

/**
 * Command that fetches a complete thread projection over HTTP. Fork and "copy
 * transcript" need every message once, and the clients' snapshot loader only
 * returns a bounded recent window, so this reads the full snapshot route
 * directly instead of paging older history into the thread store.
 */
export function createFullThreadHistoryCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | HttpClient.HttpClient | R, E>,
) {
  return createEnvironmentCommand(runtime, {
    label: "environment-data:threads:full-snapshot",
    execute: Effect.fn("FullThreadHistory.execute")(function* (threadId: ThreadId) {
      const supervisor = yield* EnvironmentSupervisor;
      const prepared = yield* SubscriptionRef.get(supervisor.prepared);
      if (Option.isNone(prepared)) {
        return yield* new FullThreadHistoryError({
          message: "Reconnect the environment to load this chat's history.",
        });
      }
      const signer = yield* Effect.serviceOption(ManagedRelay.ManagedRelayDpopSigner);
      const remoteAuthorization = yield* Effect.serviceOption(
        RemoteEnvironmentAuthorization.RemoteEnvironmentAuthorization,
      );
      const snapshot = yield* fetchFullThreadSnapshot({
        prepared: prepared.value,
        threadId,
        signer,
        remoteAuthorization,
      }).pipe(
        Effect.mapError(
          () => new FullThreadHistoryError({ message: "Could not load the full chat history." }),
        ),
      );
      return snapshot.projection satisfies OrchestrationV2ThreadProjection;
    }),
  });
}
