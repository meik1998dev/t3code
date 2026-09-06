import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions, buildTaskTrackingInstructions } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it.each(["Codex", "Claude Code", "Cursor", "Grok", "OpenCode", "Antigravity"])(
    "identifies the %s harness and describes media embedding",
    (harness) => {
      const instructions = buildRuntimeInstructions({ harness });
      expect(instructions).toContain(`running in T3 Code through the ${harness} harness.`);
      expect(instructions).toContain("embed images and videos");
      expect(instructions).toContain("Markdown with absolute file paths");
      expect(instructions).not.toContain("undefined");
    },
  );

  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
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
    expect(instructions).toContain("3 or more steps");
    expect(instructions).toContain("TaskCreate and TaskUpdate");
    expect(instructions).toMatch(/^<task_tracking>.*<\/task_tracking>$/u);
  });

  it("names a shared tool once", () => {
    const instructions = buildTaskTrackingInstructions({
      create: "update_plan",
      update: "update_plan",
    });
    expect(instructions).toContain("task list with update_plan.");
    expect(instructions).not.toContain("update_plan and update_plan");
  });
});
