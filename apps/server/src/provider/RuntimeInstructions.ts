const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

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
  return `<runtime_info>In case you're asked: you are running in Spindle through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}

/**
 * Asks the agent to keep a task list for multi-step work. T3 renders the
 * provider's task tool calls as the thread task list, and newer models only
 * open one when told to, so this is what keeps the list populated by default.
 * The rule is mechanical on purpose: models treat "create 3 files" as one
 * shell command unless each deliverable is counted as a step. The tool
 * names differ per provider; callers pass the pair the harness exposes.
 */
export function buildTaskTrackingInstructions(tools: {
  readonly create: string;
  readonly update: string;
}): string {
  const toolNames =
    tools.create === tools.update ? tools.create : `${tools.create} and ${tools.update}`;
  return `<task_tracking>Spindle shows your ${toolNames} calls as a task list in the UI. The user relies on it, so keep one for every request that names 3 or more things to make, change or check. Count each file, change or check as one step, even if you could do them all in one command. For example, "create 3 files" is 3 steps. Before the first tool call, create every step with ${tools.create}. Mark a step in_progress when you begin it and completed as soon as it is done. Skip the list only for one- or two-step requests.</task_tracking>`;
}
