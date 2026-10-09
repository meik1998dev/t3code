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
import * as ManagedRelay from "../relay/managedRelay.ts";
import { createEnvironmentCommand } from "./runtime.ts";
import { fetchEnvironmentThreadSnapshot } from "./threadSnapshotHttp.ts";

export class FullThreadHistoryError extends Data.TaggedError("FullThreadHistoryError")<{
  readonly message: string;
}> {}

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
    execute: (threadId: ThreadId) =>
      Effect.gen(function* () {
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
        const snapshot = yield* fetchEnvironmentThreadSnapshot({
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
