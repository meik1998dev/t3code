import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as ThreadThinkingPreview from "./ThreadThinkingPreview.ts";

const { THINKING_PREVIEW_MAX_CHARS, THINKING_PREVIEW_PUBLISH_INTERVAL_MS } = ThreadThinkingPreview;

/** Collects `count` published previews from a fresh subscription. */
const collect = (
  service: ThreadThinkingPreview.ThreadThinkingPreviewService["Service"],
  count: number,
) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      service.changes.pipe(Stream.take(count), Stream.runCollect),
    );
    // Give the subscription a tick to attach before the caller publishes.
    yield* Effect.yieldNow;
    return fiber;
  });

describe("ThreadThinkingPreview", () => {
  it("keeps only the tail of the reasoning text", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        const threadId = "t-think-1";
        yield* service.recordReasoningDelta(threadId, "a".repeat(THINKING_PREVIEW_MAX_CHARS), 0);
        yield* service.recordReasoningDelta(threadId, "TAIL", THINKING_PREVIEW_PUBLISH_INTERVAL_MS);
        const preview = service.getThreadThinkingPreview(threadId);
        expect(preview?.text.length).toBe(THINKING_PREVIEW_MAX_CHARS);
        expect(preview?.text.endsWith("TAIL")).toBe(true);
      }),
    );
  });

  it("publishes at most once per interval and catches up on the next delta", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        const threadId = "t-think-2";
        const fiber = yield* collect(service, 2);
        yield* service.recordReasoningDelta(threadId, "one ", 0);
        yield* service.recordReasoningDelta(threadId, "two ", 10);
        yield* service.recordReasoningDelta(
          threadId,
          "three",
          THINKING_PREVIEW_PUBLISH_INTERVAL_MS,
        );
        const published = yield* Fiber.join(fiber);
        expect(published.map((preview) => preview.text)).toEqual(["one ", "one two three"]);
      }),
    );
  });

  it("clear publishes an empty preview only when one was live", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        const threadId = "t-think-3";
        const fiber = yield* collect(service, 2);
        yield* service.clearThreadThinkingPreview(threadId, 0);
        yield* service.recordReasoningDelta(threadId, "thinking", 0);
        yield* service.clearThreadThinkingPreview(threadId, 5);
        const published = yield* Fiber.join(fiber);
        expect(published.map((preview) => preview.text)).toEqual(["thinking", ""]);
        expect(service.getThreadThinkingPreview(threadId)).toBeNull();
      }),
    );
  });

  it("ignores empty deltas", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        yield* service.recordReasoningDelta("t-think-4", "", 0);
        expect(service.getThreadThinkingPreview("t-think-4")).toBeNull();
      }),
    );
  });
});
