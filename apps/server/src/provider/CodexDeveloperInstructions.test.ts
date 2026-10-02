import { describe, expect, it } from "vite-plus/test";
import { buildCodexAdditionalContext } from "./CodexDeveloperInstructions.ts";

describe("buildCodexAdditionalContext", () => {
  const runtime = { model: "gpt-5.6", reasoningEffort: "high" };
  const runtimeValue = (context: ReturnType<typeof buildCodexAdditionalContext>) =>
    context.t3_code_runtime?.value ?? "";

  it("asks for update_plan tracking in Default mode", () => {
    const value = runtimeValue(
      buildCodexAdditionalContext(runtime, true, { interactionMode: "default" }),
    );
    expect(value).toContain("<task_tracking>");
    expect(value).toContain("update_plan");
    expect(value.indexOf("<runtime_info>")).toBeLessThan(value.indexOf("<task_tracking>"));
  });

  it("leaves task tracking out of Plan mode where update_plan is rejected", () => {
    const value = runtimeValue(
      buildCodexAdditionalContext(runtime, true, { interactionMode: "plan" }),
    );
    expect(value).not.toContain("<task_tracking>");
    expect(value).toContain("<runtime_info>");
  });

  it("describes thread tools only when the turn's credential grants them", () => {
    expect(
      runtimeValue(buildCodexAdditionalContext(runtime, true, { threadToolsAvailable: true })),
    ).toContain("start_thread");
    expect(runtimeValue(buildCodexAdditionalContext(runtime, true))).not.toContain("start_thread");
  });

  it("keeps the runtime entry under Codex's per-entry token cap with every block on", () => {
    const value = runtimeValue(
      buildCodexAdditionalContext(runtime, true, {
        interactionMode: "default",
        threadToolsAvailable: true,
      }),
    );
    // Codex estimates 4 bytes per token and truncates the middle of longer values.
    expect(Buffer.byteLength(value)).toBeLessThan(4_000);
  });
});
