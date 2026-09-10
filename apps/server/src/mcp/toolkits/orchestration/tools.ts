import {
  ProjectId,
  ProviderInstanceId,
  ProviderInteractionMode,
  RuntimeMode,
  ThreadEnvMode,
  ThreadId,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/unstable/ai";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ThreadBootstrap from "../../../orchestration/ThreadBootstrap.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

/** Every orchestration failure the agent can act on carries a plain message. */
export class ThreadOrchestrationError extends Schema.TaggedErrorClass<ThreadOrchestrationError>()(
  "ThreadOrchestrationError",
  { message: Schema.String },
) {}

const dependencies = [
  Crypto.Crypto,
  McpInvocationContext.McpInvocationContext,
  ProjectionSnapshotQuery.ProjectionSnapshotQuery,
  ProviderRegistry.ProviderRegistry,
  GitWorkflowService.GitWorkflowService,
  ThreadBootstrap.ThreadBootstrap,
  ServerSettings.ServerSettingsService,
];

const ModelChoice = Schema.Struct({
  instanceId: ProviderInstanceId.annotate({
    description: "Provider instance id from list_models, for example `codex` or `claudeAgent`.",
  }),
  model: TrimmedNonEmptyString.annotate({ description: "Model slug from list_models." }),
});

const readonlyTool = <T extends Tool.Any>(tool: T): T =>
  tool
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false) as T;

export const ListProjectsTool = readonlyTool(
  Tool.make("list_projects", {
    description:
      "List the T3 Code projects on this machine. Use a project id with start_thread. `defaultWorkspace` is what start_thread uses when `workspace` is omitted.",
    success: Schema.Struct({
      projects: Schema.Array(
        Schema.Struct({
          id: ProjectId,
          title: Schema.String,
          workspaceRoot: Schema.String,
          defaultModel: Schema.NullOr(ModelChoice),
          defaultWorkspace: ThreadEnvMode,
        }),
      ),
    }),
    failure: ThreadOrchestrationError,
    dependencies,
  }).annotate(Tool.Title, "List projects"),
);

export const ListModelsTool = readonlyTool(
  Tool.make("list_models", {
    description:
      "List the providers and models a new thread can use, plus the user's routing notes. Pass `instanceId` and one model `slug` as start_thread's `model`, and one of the model's `effortOptions` as `effort`. Follow `routingNotes` when choosing a model and effort. Providers that are not ready are listed with their status so you can tell the user why.",
    success: Schema.Struct({
      routingNotes: Schema.String.annotate({
        description:
          "The user's guidance on which model and effort suit which work. Empty when the user wrote none.",
      }),
      providers: Schema.Array(
        Schema.Struct({
          instanceId: ProviderInstanceId,
          driver: Schema.String,
          displayName: Schema.optional(Schema.String),
          status: Schema.String,
          models: Schema.Array(
            Schema.Struct({
              slug: Schema.String,
              name: Schema.String,
              isDefault: Schema.Boolean,
              effortOptions: Schema.Array(Schema.String),
            }),
          ),
        }),
      ),
    }),
    failure: ThreadOrchestrationError,
    dependencies,
  }).annotate(Tool.Title, "List models"),
);

export const ThreadPhase = Schema.Literals([
  "idle",
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
  "completed",
  "failed",
  "stale",
]);

export const ListThreadsTool = readonlyTool(
  Tool.make("list_threads", {
    description:
      "List active (not archived) T3 Code threads, newest first, with branch, worktree, model and status. Check this before start_thread so you do not start the same task twice.",
    parameters: Schema.Struct({
      projectId: Schema.optional(ProjectId).annotate({
        description: "Only list threads in this project.",
      }),
      startedByThisThread: Schema.optional(Schema.Boolean).annotate({
        description: "Only list threads this thread started.",
      }),
    }),
    success: Schema.Struct({
      threads: Schema.Array(
        Schema.Struct({
          id: ThreadId,
          projectId: ProjectId,
          title: Schema.String,
          branch: Schema.NullOr(Schema.String),
          worktreePath: Schema.NullOr(Schema.String),
          parentThreadId: Schema.NullOr(ThreadId),
          model: ModelChoice,
          status: ThreadPhase,
          updatedAt: Schema.String,
        }),
      ),
    }),
    failure: ThreadOrchestrationError,
    dependencies,
  }).annotate(Tool.Title, "List threads"),
);

export const ReadThreadTool = readonlyTool(
  Tool.make("read_thread", {
    description: [
      "Read another T3 Code thread's details and the files it changed, for example to review its work. It does not return the chat.",
      "Per-file line counts are summed over the thread's turns.",
      "`workspacePath` is where the thread's files are, including changes it has not committed, so review code there rather than from its branch. Never edit files in another thread's workspace.",
    ].join(" "),
    parameters: Schema.Struct({
      threadId: ThreadId.annotate({ description: "Thread id from list_threads." }),
    }),
    success: Schema.Struct({
      id: ThreadId,
      projectId: ProjectId,
      title: Schema.String,
      branch: Schema.NullOr(Schema.String),
      worktreePath: Schema.NullOr(Schema.String),
      workspacePath: Schema.String.annotate({
        description: "The thread's worktree, or the project checkout for a local thread.",
      }),
      parentThreadId: Schema.NullOr(ThreadId),
      model: ModelChoice,
      status: ThreadPhase,
      changedFiles: Schema.Array(
        Schema.Struct({
          path: Schema.String,
          additions: Schema.Number,
          deletions: Schema.Number,
        }),
      ),
    }),
    failure: ThreadOrchestrationError,
    dependencies,
  }).annotate(Tool.Title, "Read thread"),
);

export const StartThreadTool = Tool.make("start_thread", {
  description: [
    "Start a new T3 Code thread that works on a task by itself, visible to the user in the sidebar.",
    "Use it for work that needs its own branch, a different model or provider, a different project, or should keep going after this turn ends.",
    "Do not use it for research or parallel steps you can do with your own sub-agents.",
    "`workspace: 'worktree'` creates a fresh git worktree and branch from `baseBranch` (default: the project's current branch) and runs the project setup script; `'local'` works in the project checkout itself.",
    "The new thread cannot start threads of its own. Returns immediately; the thread keeps running.",
  ].join(" "),
  parameters: Schema.Struct({
    projectId: ProjectId.annotate({ description: "Project id from list_projects." }),
    title: TrimmedNonEmptyString.annotate({ description: "Short thread title." }),
    prompt: TrimmedNonEmptyString.annotate({
      description:
        "The first message the new thread receives. Make it self-contained: the thread does not see this conversation.",
    }),
    model: Schema.optional(ModelChoice).annotate({
      description: "Defaults to the project's default model, else this thread's model.",
    }),
    effort: Schema.optional(TrimmedNonEmptyString).annotate({
      description:
        "Reasoning effort, one of the model's `effortOptions` from list_models. Defaults to this thread's effort when the model is the same, else the model's default.",
    }),
    workspace: Schema.optional(ThreadEnvMode).annotate({
      description: "Defaults to the project's default, else `worktree`.",
    }),
    branch: Schema.optional(TrimmedNonEmptyString).annotate({
      description:
        "Worktree only. New branch name. Omit to let T3 Code name it from the task after the first turn.",
    }),
    baseBranch: Schema.optional(TrimmedNonEmptyString).annotate({
      description: "Worktree only. Branch to start from. Defaults to the project's current branch.",
    }),
    runtimeMode: Schema.optional(RuntimeMode).annotate({
      description: "Defaults to this thread's mode. Cannot be more permissive than this thread.",
    }),
    interactionMode: Schema.optional(ProviderInteractionMode).annotate({
      description: "`plan` makes the thread propose a plan first. Defaults to `default`.",
    }),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    projectId: ProjectId,
    workspace: ThreadEnvMode,
    model: ModelChoice,
    effort: Schema.NullOr(Schema.String).annotate({
      description: "The effort the thread runs with. Null means the model's default.",
    }),
    runtimeMode: RuntimeMode,
  }),
  failure: ThreadOrchestrationError,
  dependencies,
})
  .annotate(Tool.Title, "Start thread")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const SendMessageTool = Tool.make("send_message", {
  description: [
    "Send a follow-up message to a thread you started, which starts a new turn there with its own model and settings.",
    "The message is labeled as coming from this thread. It is refused while that thread is busy or waiting on the user, so check list_threads status first.",
    "You can only message threads this thread started.",
  ].join(" "),
  parameters: Schema.Struct({
    threadId: ThreadId.annotate({
      description: "A thread this thread started, from list_threads.",
    }),
    text: TrimmedNonEmptyString.annotate({
      description:
        "The message. Make it self-contained: the thread does not see this conversation.",
    }),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    sentAt: Schema.String,
  }),
  failure: ThreadOrchestrationError,
  dependencies,
})
  .annotate(Tool.Title, "Send message")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const OrchestrationToolkit = Toolkit.make(
  ListProjectsTool,
  ListModelsTool,
  ListThreadsTool,
  ReadThreadTool,
  StartThreadTool,
  SendMessageTool,
);
