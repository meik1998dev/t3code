/**
 * ThreadThinkingPreviewService - in-memory per-thread tail of the provider's
 * reasoning text while a turn runs, for the in-chat "Thinking" row.
 *
 * Reasoning deltas are a draft, not history: they can be huge and are only
 * useful to show that the agent is alive and what it is chewing on right
 * now. Ingestion feeds deltas here; the thread subscription forwards the
 * published tail to opted-in clients. Nothing is persisted, and the entry
 * is cleared when the turn settles or the session dies (same pattern as
 * ThreadPlanProgressService).
 *
 * Publishing is throttled per thread by a timestamp gate with no timers: a
 * delta inside the window updates the buffer but does not publish, and the
 * next delta after the window publishes the whole tail. The last few
 * hundred milliseconds of a thinking block may never be sent; that is fine
 * for a preview and keeps the websocket quiet.
 *
 * @module ThreadThinkingPreviewService
 */
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";

export interface ThreadThinkingPreview {
  readonly threadId: string;
  /** Empty when the preview was cleared. */
  readonly text: string;
  readonly updatedAt: string;
}

/** Characters kept from the end of the reasoning stream. */
export const THINKING_PREVIEW_MAX_CHARS = 240;
/** Minimum gap between two publishes for one thread. */
export const THINKING_PREVIEW_PUBLISH_INTERVAL_MS = 250;

interface ThreadPreviewState {
  text: string;
  lastPublishedAtMs: number;
}

export class ThreadThinkingPreviewService extends Context.Service<
  ThreadThinkingPreviewService,
  {
    /** Append one reasoning delta. `nowMs` drives the publish throttle. */
    readonly recordReasoningDelta: (
      threadId: string,
      delta: string,
      nowMs: number,
    ) => Effect.Effect<void>;

    /** Turn settled or session died. Publishes an empty preview if one was live. */
    readonly clearThreadThinkingPreview: (threadId: string, nowMs: number) => Effect.Effect<void>;

    readonly getThreadThinkingPreview: (threadId: string) => ThreadThinkingPreview | null;

    /** Fresh subscription per access, like OrchestrationEngine.streamDomainEvents. */
    readonly changes: Stream.Stream<ThreadThinkingPreview>;
  }
>()("t3/orchestration/ThreadThinkingPreview/ThreadThinkingPreviewService") {}

export const make = Effect.gen(function* () {
  const pubSub = yield* PubSub.unbounded<ThreadThinkingPreview>();
  const stateByThreadId = new Map<string, ThreadPreviewState>();

  const snapshot = (threadId: string, text: string, nowMs: number): ThreadThinkingPreview => ({
    threadId,
    text,
    updatedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
  });

  return {
    recordReasoningDelta: (threadId, delta, nowMs) =>
      Effect.suspend(() => {
        if (delta.length === 0) {
          return Effect.void;
        }
        const existing = stateByThreadId.get(threadId);
        const joined = (existing?.text ?? "") + delta;
        const text =
          joined.length > THINKING_PREVIEW_MAX_CHARS
            ? joined.slice(joined.length - THINKING_PREVIEW_MAX_CHARS)
            : joined;
        const lastPublishedAtMs = existing?.lastPublishedAtMs ?? Number.NEGATIVE_INFINITY;
        if (nowMs - lastPublishedAtMs < THINKING_PREVIEW_PUBLISH_INTERVAL_MS) {
          stateByThreadId.set(threadId, { text, lastPublishedAtMs });
          return Effect.void;
        }
        stateByThreadId.set(threadId, { text, lastPublishedAtMs: nowMs });
        return PubSub.publish(pubSub, snapshot(threadId, text, nowMs)).pipe(Effect.asVoid);
      }),

    clearThreadThinkingPreview: (threadId, nowMs) =>
      Effect.suspend(() => {
        if (!stateByThreadId.delete(threadId)) {
          return Effect.void;
        }
        return PubSub.publish(pubSub, snapshot(threadId, "", nowMs)).pipe(Effect.asVoid);
      }),

    getThreadThinkingPreview: (threadId) => {
      const existing = stateByThreadId.get(threadId);
      return existing === undefined
        ? null
        : snapshot(threadId, existing.text, Math.max(existing.lastPublishedAtMs, 0));
    },

    get changes() {
      return Stream.fromPubSub(pubSub);
    },
  } satisfies ThreadThinkingPreviewService["Service"];
});

export const layer = Layer.effect(ThreadThinkingPreviewService, make);
