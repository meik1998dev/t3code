import { describe, expect, it } from "vite-plus/test";
import { buildForkTranscript, type ForkTranscriptEntry } from "./forkTranscript.js";
import { CheckpointRef, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { checkpointRefForThreadTurn } from "@t3tools/shared/git";
import { resolveForkPointCheckpointRef } from "./forkTranscript.js";

describe("buildForkTranscript", () => {
  it("keeps message order through the fork point and drops non-message entries", () => {
    const entries: ForkTranscriptEntry[] = [
      { kind: "message", message: { id: "user-1", role: "user", text: "First question" } },
      { kind: "work", entry: { output: "hidden tool output" } },
      {
        kind: "message",
        message: { id: "assistant-1", role: "assistant", text: "First answer" },
      },
      { kind: "message", message: { id: "user-2", role: "user", text: "Fork here" } },
      {
        kind: "message",
        message: { id: "assistant-2", role: "assistant", text: "After fork point" },
      },
    ];

    expect(buildForkTranscript("Source chat", entries, "user-2")).toBe(
      [
        "Forked from Source chat",
        "**User:**\nFirst question",
        "**Assistant:**\nFirst answer",
        "**User:**\nFork here",
      ].join("\n\n"),
    );
  });

  it("returns null when the fork point is not in the loaded entries", () => {
    expect(buildForkTranscript("Source chat", [], "missing")).toBeNull();
  });
});

describe("resolveForkPointCheckpointRef", () => {
  const threadId = ThreadId.make("thread-1");
  const userMessageId = MessageId.make("user-1");
  const assistantMessageId = MessageId.make("assistant-1");
  const turnId = TurnId.make("turn-1");
  const checkpointRef = CheckpointRef.make("refs/t3/checkpoints/thread-1/turn/1");
  const checkpoints = [
    {
      turnId,
      checkpointTurnCount: 1,
      checkpointRef,
      status: "ready" as const,
      assistantMessageId,
    },
  ];

  it("uses the pre-turn baseline for a user message", () => {
    expect(
      resolveForkPointCheckpointRef(
        threadId,
        { id: userMessageId, role: "user", turnId },
        checkpoints,
      ),
    ).toBe(checkpointRefForThreadTurn(threadId, 0));
  });

  it("uses the post-turn checkpoint for an assistant message", () => {
    expect(
      resolveForkPointCheckpointRef(
        threadId,
        { id: assistantMessageId, role: "assistant", turnId },
        checkpoints,
      ),
    ).toBe(checkpointRef);
  });

  it("returns null when the checkpoint is not ready", () => {
    expect(
      resolveForkPointCheckpointRef(
        threadId,
        { id: assistantMessageId, role: "assistant", turnId },
        [{ ...checkpoints[0]!, status: "error" }],
      ),
    ).toBeNull();
  });
});
