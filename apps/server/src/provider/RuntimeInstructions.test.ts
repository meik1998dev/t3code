import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions, buildTaskTrackingInstructions } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("requires explicit registration of every PR and stack layer", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });
    expect(instructions).toContain("When the t3-code MCP server exposes link_pull_request");
    expect(instructions).toContain("with the full PR URL immediately after creating a PR");
    expect(instructions).toContain("For a stack, call it for every layer");
    expect(instructions).toContain("call list_thread_pull_requests and link any PR");
  });

  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
  });

  it("describes thread tools only when the turn's credential grants them", () => {
    expect(buildRuntimeInstructions({ harness: "Codex", threadTools: true })).toContain(
      "start_thread",
    );
    // Child threads and sessions without the t3-code server must not be told
    // about tools that would fail.
    expect(buildRuntimeInstructions({ harness: "Codex", threadTools: false })).not.toContain(
      "start_thread",
    );
    expect(buildRuntimeInstructions({ harness: "Codex" })).not.toContain("start_thread");
  });

  it("tells the agent to route by the user's notes before the general rules", () => {
    const instructions = buildRuntimeInstructions({ harness: "Claude", threadTools: true });
    const block = instructions.slice(instructions.indexOf("<t3_threads>"));
    expect(block).toContain("Call list_models first");
    expect(block).toContain("routingNotes are the user's preferences and win over these rules");
    // A branch misses uncommitted work, so reviews must read the thread's files on disk.
    expect(block).toContain("gives the reviewer that thread's workspacePath");
    expect(block).toContain("use send_message after it finishes its turn");
    // The block rides along on every turn, so it has to stay short.
    expect(block.split(/\s+/u).length).toBeLessThan(200);
  });

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });
});

describe("buildTaskTrackingInstructions", () => {
  it("names the provider's task tools and the 3-step threshold", () => {
    const instructions = buildTaskTrackingInstructions({
      create: "TaskCreate",
      update: "TaskUpdate",
    });
    expect(instructions).toContain("3 or more things");
    expect(instructions).toContain("TaskCreate and TaskUpdate calls");
    expect(instructions).toContain("create every step with TaskCreate");
    expect(instructions).toMatch(/^<task_tracking>.*<\/task_tracking>$/u);
  });

  it("names a shared tool once", () => {
    const instructions = buildTaskTrackingInstructions({
      create: "update_plan",
      update: "update_plan",
    });
    expect(instructions).toContain("your update_plan calls");
    expect(instructions).not.toContain("update_plan and update_plan");
  });
});
