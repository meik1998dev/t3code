import { describe, expect, it } from "vite-plus/test";
import {
  buildForkTranscript,
  resolveLatestCompactionAt,
  type ForkTranscriptEntry,
} from "./forkTranscript.js";
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

  it("drops messages created before the compaction cut-off when forking after it", () => {
    const entries: ForkTranscriptEntry[] = [
      {
        kind: "message",
        message: { id: "user-1", role: "user", text: "Old", createdAt: "2026-01-01T00:00:00Z" },
      },
      {
        kind: "message",
        message: {
          id: "assistant-1",
          role: "assistant",
          text: "Old answer",
          createdAt: "2026-01-01T00:01:00Z",
        },
      },
      {
        kind: "message",
        message: { id: "user-2", role: "user", text: "New", createdAt: "2026-01-01T00:03:00Z" },
      },
      {
        kind: "message",
        message: {
          id: "assistant-2",
          role: "assistant",
          text: "New answer",
          createdAt: "2026-01-01T00:04:00Z",
        },
      },
    ];

    expect(
      buildForkTranscript("Source chat", entries, "assistant-2", {
        afterCompactionAt: "2026-01-01T00:03:00Z",
      }),
    ).toBe(
      [
        "Forked from Source chat after a context compaction. Earlier messages are not included.",
        "**User:**\nNew",
        "**Assistant:**\nNew answer",
      ].join("\n\n"),
    );
  });
});

describe("resolveLatestCompactionAt", () => {
  const activities = [
    { kind: "context-compaction", createdAt: "2026-01-01T00:02:00Z" },
    { kind: "tool", createdAt: "2026-01-01T00:03:00Z" },
    { kind: "context-compaction", createdAt: "2026-01-01T00:05:00Z" },
  ];
  const messages = [
    { role: "user" as const, createdAt: "2026-01-01T00:01:00Z" },
    { role: "assistant" as const, createdAt: "2026-01-01T00:01:30Z" },
    { role: "user" as const, createdAt: "2026-01-01T00:04:00Z" },
    { role: "assistant" as const, createdAt: "2026-01-01T00:06:00Z" },
  ];

  it("cuts at the user message that opened the turn reporting the compaction", () => {
    expect(resolveLatestCompactionAt(activities, messages, "2026-01-01T00:06:00Z")).toBe(
      "2026-01-01T00:04:00Z",
    );
    expect(resolveLatestCompactionAt(activities, messages, "2026-01-01T00:03:00Z")).toBe(
      "2026-01-01T00:01:00Z",
    );
  });

  it("offers the compaction on the user message that opened its turn", () => {
    expect(resolveLatestCompactionAt(activities, messages, "2026-01-01T00:04:00Z")).toBe(
      "2026-01-01T00:04:00Z",
    );
  });

  it("falls back to the marker time when no user message precedes it", () => {
    expect(resolveLatestCompactionAt(activities, [], "2026-01-01T00:06:00Z")).toBe(
      "2026-01-01T00:05:00Z",
    );
  });

  it("returns null when nothing was compacted before the fork point", () => {
    expect(resolveLatestCompactionAt(activities, messages, "2026-01-01T00:00:30Z")).toBeNull();
    expect(resolveLatestCompactionAt([], messages, "2026-01-01T00:09:00Z")).toBeNull();
  });

  it("does not apply a future compaction to a message before its turn starts", () => {
    expect(
      resolveLatestCompactionAt(
        [{ kind: "context-compaction", createdAt: "2026-01-01T00:03:30Z" }],
        [
          { role: "user", createdAt: "2026-01-01T00:01:00Z" },
          { role: "assistant", createdAt: "2026-01-01T00:02:00Z" },
          { role: "user", createdAt: "2026-01-01T00:03:00Z" },
        ],
        "2026-01-01T00:02:00Z",
      ),
    ).toBeNull();
  });

  it("falls back to the marker only after the marker is reached", () => {
    const activity = [{ kind: "context-compaction", createdAt: "2026-01-01T00:05:00Z" }];
    expect(resolveLatestCompactionAt(activity, [], "2026-01-01T00:04:00Z")).toBeNull();
    expect(resolveLatestCompactionAt(activity, [], "2026-01-01T00:05:00Z")).toBe(
      "2026-01-01T00:05:00Z",
    );
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
