/**
 * Shared runtime context; omit model and effort when the harness manages them dynamically.
 *
 * `threadTools` must reflect the turn's actual MCP credential: telling a child
 * thread about tools it cannot use would send it into a failing tool call.
 */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly threadTools?: boolean | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  const runtimeInfo = `<runtime_info>In case you're asked: you are running in Spindle through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>`;
  return runtime.threadTools === true
    ? `${runtimeInfo}\n\n${THREAD_TOOL_INSTRUCTIONS}`
    : runtimeInfo;
}

/**
 * Routing rules are generic on purpose. The user's own model preferences live
 * in the thread routing notes setting, which list_models returns fresh on each
 * call, so edits apply without rebuilding this prompt.
 */
const THREAD_TOOL_INSTRUCTIONS = `<t3_threads>You can start separate Spindle threads with the t3-code MCP tools list_projects, list_models, list_threads, read_thread, start_thread and send_message. Use start_thread when the user asks for work to run as its own thread, or when a task needs its own branch or worktree, a different model or provider, or another project. For parallel steps inside your current task, use your own sub-agents instead.
Pick each thread's model and effort yourself unless the user names them. Call list_models first: its routingNotes are the user's preferences and win over these rules. One file, a clear recipe, or a cheap mistake: cheapest model, low effort. Many files, a hard bug, a public API, or security: strongest model, high effort. Investigation: default model, high effort. Unsure: your own model and effort.
Before starting more than one thread, show a short table of task, model, effort and branch.
To give a thread you started a follow-up, use send_message after it finishes its turn.
To review another thread, call read_thread, then start_thread with a prompt that gives the reviewer that thread's workspacePath. Its uncommitted changes exist only there, not on its branch. The reviewer only reads that path and never edits another thread's files.</t3_threads>`;

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
