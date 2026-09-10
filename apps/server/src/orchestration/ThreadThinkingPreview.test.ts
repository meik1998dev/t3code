import { describe, expect, it } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Stream from "effect/Stream";

import * as ThreadThinkingPreview from "./ThreadThinkingPreview.ts";

const { THINKING_PREVIEW_MAX_CHARS, THINKING_PREVIEW_PUBLISH_INTERVAL_MS } = ThreadThinkingPreview;

/**
 * Collects `count` published previews. `startImmediately` runs the child up to
 * its first suspension, and the PubSub subscribe is synchronous, so the
 * subscription is attached before this returns and nothing published later
 * can be missed.
 */
const collect = (
  service: ThreadThinkingPreview.ThreadThinkingPreviewService["Service"],
  count: number,
) =>
  Effect.forkChild(service.changes.pipe(Stream.take(count), Stream.runCollect), {
    startImmediately: true,
  });

describe("ThreadThinkingPreview", () => {
  it("keeps only the tail of the reasoning text", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        const threadId = "t-think-1";
        yield* service.recordReasoningDelta(
          threadId,
          "reasoning_text",
          "a".repeat(THINKING_PREVIEW_MAX_CHARS),
          0,
        );
        yield* service.recordReasoningDelta(
          threadId,
          "reasoning_text",
          "TAIL",
          THINKING_PREVIEW_PUBLISH_INTERVAL_MS,
        );
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
        yield* service.recordReasoningDelta(threadId, "reasoning_text", "one ", 0);
        yield* service.recordReasoningDelta(threadId, "reasoning_text", "two ", 10);
        yield* service.recordReasoningDelta(
          threadId,
          "reasoning_text",
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
        yield* service.recordReasoningDelta(threadId, "reasoning_text", "thinking", 0);
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
        yield* service.recordReasoningDelta("t-think-4", "reasoning_text", "", 0);
        expect(service.getThreadThinkingPreview("t-think-4")).toBeNull();
      }),
    );
  });

  it("follows the summary once raw reasoning and a summary interleave", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ThreadThinkingPreview.make;
        const threadId = "t-think-5";
        yield* service.recordReasoningDelta(threadId, "reasoning_text", "raw one ", 0);
        // Summary shows up: it replaces the raw tail instead of appending to it.
        yield* service.recordReasoningDelta(threadId, "reasoning_summary_text", "summary ", 10);
        // Later raw deltas are dropped; summary deltas keep extending the tail.
        yield* service.recordReasoningDelta(threadId, "reasoning_text", "raw two ", 20);
        yield* service.recordReasoningDelta(threadId, "reasoning_summary_text", "two", 30);
        expect(service.getThreadThinkingPreview(threadId)?.text).toBe("summary two");
      }),
    );
  });
});
