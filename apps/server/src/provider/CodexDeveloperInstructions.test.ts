import { describe, expect, it } from "vite-plus/test";
import { buildCodexDeveloperInstructions } from "./CodexDeveloperInstructions.ts";

describe("buildCodexDeveloperInstructions", () => {
  const runtime = { model: "gpt-5.6", reasoningEffort: "high" };

  it("asks for update_plan tracking in Default mode", () => {
    const instructions = buildCodexDeveloperInstructions("default", runtime);
    expect(instructions).toContain("<task_tracking>");
    expect(instructions).toContain("update_plan");
    expect(instructions.indexOf("<runtime_info>")).toBeLessThan(
      instructions.indexOf("<task_tracking>"),
    );
  });

  it("leaves task tracking out of Plan mode where update_plan is rejected", () => {
    const instructions = buildCodexDeveloperInstructions("plan", runtime);
    expect(instructions).not.toContain("<task_tracking>");
    expect(instructions).toContain("<runtime_info>");
  });
});
