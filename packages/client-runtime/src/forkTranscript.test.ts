import { describe, expect, it } from "vite-plus/test";
import { buildForkTranscript, type ForkTranscriptEntry } from "./forkTranscript.js";

describe("buildForkTranscript", () => {
  it("keeps message order through the fork point and drops non-message entries", () => {
    const entries: ForkTranscriptEntry[] = [
      { kind: "message", message: { id: "user-1", role: "user", text: "First question" } },
      { kind: "work", entry: { output: "hidden tool output" } },
      {
        kind: "message",
        message: { id: "assistant-1", role: "assistant", text: "First answer" },
      },
      {
        kind: "message",
        message: { id: "reasoning-1", role: "reasoning", text: "Hidden reasoning" },
      },
      { kind: "message", message: { id: "system-1", role: "system", text: "Hidden system" } },
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
