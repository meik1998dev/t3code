/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in T3 Code through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Asks the agent to keep a task list for multi-step work. T3 renders the
 * provider's task tool calls as the thread task list, and newer models only
 * open one when told to, so this is what keeps the list populated by default.
 * The tool names differ per provider; callers pass the pair the harness exposes.
 */
export function buildTaskTrackingInstructions(tools: {
  readonly create: string;
  readonly update: string;
}): string {
  const toolNames =
    tools.create === tools.update ? tools.create : `${tools.create} and ${tools.update}`;
  return `<task_tracking>For any work with 3 or more steps, keep a task list with ${toolNames}. Create every step before you start, mark a step in_progress when you begin it and completed as soon as it is done. Skip the list only for one- or two-step requests.</task_tracking>`;
}
