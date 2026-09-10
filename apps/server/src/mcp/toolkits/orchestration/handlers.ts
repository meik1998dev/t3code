import {
  CommandId,
  isProviderAvailable,
  MessageId,
  type ModelSelection,
  type RuntimeMode,
  type SelectProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
  ThreadId,
} from "@t3tools/contracts";
import { resolveThreadAwarenessPhase } from "@t3tools/shared/agentAwareness";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { Tool } from "effect/unstable/ai";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBootstrap from "../../../orchestration/ThreadBootstrap.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import {
  type ListThreadsTool,
  OrchestrationToolkit,
  type ReadThreadTool,
  type SendMessageTool,
  type StartThreadTool,
  ThreadOrchestrationError,
} from "./tools.ts";

/** Unsettled children one thread may have. Settling or archiving a child frees a slot. */
export const MAX_ACTIVE_CHILD_THREADS = 5;
const MAX_LISTED_THREADS = 100;

const RUNTIME_MODE_RANK: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};

/** A child may never get more autonomy than the thread that started it. */
export const isRuntimeModeWithin = (requested: RuntimeMode, parent: RuntimeMode): boolean =>
  RUNTIME_MODE_RANK[requested] <= RUNTIME_MODE_RANK[parent];

const fail = (message: string) => Effect.fail(new ThreadOrchestrationError({ message }));

const orFailWith =
  (message: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ThreadOrchestrationError, R> =>
    effect.pipe(Effect.mapError(() => new ThreadOrchestrationError({ message })));

/**
 * Guards the tools that exist to start threads. Reading threads (list_threads,
 * read_thread) only needs the MCP credential, so a child can still review work.
 */
const requireOrchestration = Effect.gen(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  if (!scope.capabilities.has("orchestration")) {
    return yield* fail(
      "This thread cannot start other threads. Threads started by another thread, and sessions without Spindle orchestration access, do not get this tool.",
    );
  }
  return scope;
});

const toModelChoice = (selection: ModelSelection) => ({
  instanceId: selection.instanceId,
  model: selection.model,
});

/** Option ids providers use for reasoning effort: Codex and Grok, Claude, Cursor, OpenCode. */
const EFFORT_OPTION_IDS: ReadonlySet<string> = new Set([
  "reasoningEffort",
  "effort",
  "reasoning",
  "variant",
]);

const findEffortDescriptor = (model: ServerProviderModel | undefined) =>
  model?.capabilities?.optionDescriptors?.find(
    (descriptor): descriptor is SelectProviderOptionDescriptor =>
      descriptor.type === "select" && EFFORT_OPTION_IDS.has(descriptor.id),
  );

const findOfferedModel = (provider: ServerProvider, slug: string) =>
  provider.models.find((model) => model.slug === slug || model.aliases?.includes(slug));

const readEffort = (
  selection: ModelSelection,
  descriptor: SelectProviderOptionDescriptor | undefined,
) => {
  const value = selection.options?.find((option) => option.id === descriptor?.id)?.value;
  return typeof value === "string" ? value : null;
};

const readShellSnapshot = Effect.gen(function* () {
  const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  return yield* query.getShellSnapshot();
}).pipe(orFailWith("Could not read Spindle threads. Try again."));

const list_projects = () =>
  Effect.gen(function* () {
    yield* requireOrchestration;
    const snapshot = yield* readShellSnapshot;
    return {
      projects: snapshot.projects.map((project) => ({
        id: project.id,
        title: project.title,
        workspaceRoot: project.workspaceRoot,
        defaultModel: project.defaultModelSelection
          ? toModelChoice(project.defaultModelSelection)
          : null,
        defaultWorkspace: project.defaultThreadEnvMode ?? "worktree",
      })),
    };
  });

const list_models = () =>
  Effect.gen(function* () {
    yield* requireOrchestration;
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const providers = yield* registry.getProviders;
    // Read on every call so edits in Settings apply to running sessions.
    const settings = yield* ServerSettings.ServerSettingsService;
    const { threadRoutingNotes } = yield* settings.getSettings.pipe(
      orFailWith("Could not read Spindle settings. Try again."),
    );
    return {
      routingNotes: threadRoutingNotes,
      providers: providers
        .filter((provider) => provider.enabled && isProviderAvailable(provider))
        .map((provider) => ({
          instanceId: provider.instanceId,
          driver: provider.driver,
          ...(provider.displayName ? { displayName: provider.displayName } : {}),
          status: provider.installed ? provider.status : "not-installed",
          models: provider.models.map((model) => ({
            slug: model.slug,
            name: model.name,
            isDefault: model.isDefault === true,
            effortOptions: findEffortDescriptor(model)?.options.map((option) => option.id) ?? [],
          })),
        })),
    };
  });

const list_threads = (input: Tool.Parameters<typeof ListThreadsTool>) =>
  Effect.gen(function* () {
    const scope = yield* McpInvocationContext.McpInvocationContext;
    const snapshot = yield* readShellSnapshot;
    const threads = snapshot.threads
      .filter(
        (thread) =>
          (input.projectId === undefined || thread.projectId === input.projectId) &&
          (input.startedByThisThread !== true || thread.parentThreadId === scope.threadId),
      )
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_LISTED_THREADS);
    return {
      threads: threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        title: thread.title,
        branch: thread.branch,
        worktreePath: thread.worktreePath,
        parentThreadId: thread.parentThreadId ?? null,
        model: toModelChoice(thread.modelSelection),
        status: resolveThreadAwarenessPhase(thread) ?? ("idle" as const),
        updatedAt: thread.updatedAt,
      })),
    };
  });

/**
 * Thread facts and changed files only. The chat is left out on purpose: it can
 * be very long, and a reviewer learns more from the files than from the talk.
 */
const read_thread = (input: Tool.Parameters<typeof ReadThreadTool>) =>
  Effect.gen(function* () {
    const query = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
    const shell = yield* query
      .getThreadShellById(input.threadId)
      .pipe(orFailWith("Could not read the thread. Try again."));
    const context = yield* query
      .getThreadCheckpointContext(input.threadId)
      .pipe(orFailWith("Could not read the thread. Try again."));
    if (Option.isNone(shell) || Option.isNone(context)) {
      return yield* fail(
        `Thread ${input.threadId} was not found or is archived. Call list_threads.`,
      );
    }
    const thread = shell.value;

    const changedFiles = new Map<string, { path: string; additions: number; deletions: number }>();
    for (const checkpoint of context.value.checkpoints) {
      for (const file of checkpoint.files) {
        const entry = changedFiles.get(file.path) ?? {
          path: file.path,
          additions: 0,
          deletions: 0,
        };
        entry.additions += file.additions;
        entry.deletions += file.deletions;
        changedFiles.set(file.path, entry);
      }
    }

    return {
      id: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      branch: thread.branch,
      worktreePath: thread.worktreePath,
      // Uncommitted work exists only on disk, so a reviewer reads this path, not the branch.
      workspacePath: context.value.worktreePath ?? context.value.workspaceRoot,
      parentThreadId: thread.parentThreadId ?? null,
      model: toModelChoice(thread.modelSelection),
      status: resolveThreadAwarenessPhase(thread) ?? ("idle" as const),
      changedFiles: [...changedFiles.values()],
    };
  });

const start_thread = (input: Tool.Parameters<typeof StartThreadTool>) =>
  Effect.gen(function* () {
    const scope = yield* requireOrchestration;
    const snapshot = yield* readShellSnapshot;

    const project = snapshot.projects.find((candidate) => candidate.id === input.projectId);
    if (!project) {
      return yield* fail(`Project ${input.projectId} was not found. Call list_projects.`);
    }
    const parent = snapshot.threads.find((thread) => thread.id === scope.threadId);
    if (!parent) {
      return yield* fail("This thread is archived or deleted, so it cannot start threads.");
    }
    const activeChildren = snapshot.threads.filter(
      (thread) => thread.parentThreadId === scope.threadId && thread.settledOverride !== "settled",
    ).length;
    if (activeChildren >= MAX_ACTIVE_CHILD_THREADS) {
      return yield* fail(
        `This thread already has ${activeChildren} active threads it started. Ask the user to settle or archive finished ones before starting more.`,
      );
    }

    // Naming the parent's own model keeps the parent's options, effort included.
    const namesParentModel =
      input.model?.instanceId === parent.modelSelection.instanceId &&
      input.model.model === parent.modelSelection.model;
    const baseSelection: ModelSelection =
      input.model && !namesParentModel
        ? { instanceId: input.model.instanceId, model: input.model.model }
        : input.model
          ? parent.modelSelection
          : (project.defaultModelSelection ?? parent.modelSelection);
    const registry = yield* ProviderRegistry.ProviderRegistry;
    const provider = (yield* registry.getProviders).find(
      (candidate) => candidate.instanceId === baseSelection.instanceId,
    );
    if (!provider || !provider.enabled || !isProviderAvailable(provider)) {
      return yield* fail(
        `Provider ${baseSelection.instanceId} is not available. Call list_models for the providers you can use.`,
      );
    }
    const offeredModel = findOfferedModel(provider, baseSelection.model);
    if (input.model && provider.models.length > 0 && !offeredModel) {
      return yield* fail(
        `Model ${input.model.model} is not offered by ${provider.instanceId}. Call list_models.`,
      );
    }
    const effortDescriptor = findEffortDescriptor(offeredModel);
    const requestedEffort = input.effort;
    let modelSelection = baseSelection;
    if (requestedEffort !== undefined) {
      const allowed = effortDescriptor?.options.map((option) => option.id) ?? [];
      if (!effortDescriptor || !allowed.includes(requestedEffort)) {
        return yield* fail(
          allowed.length === 0
            ? `Model ${baseSelection.model} has no effort setting. Omit effort.`
            : `Effort ${requestedEffort} is not offered by ${baseSelection.model}. Use one of: ${allowed.join(", ")}.`,
        );
      }
      modelSelection = {
        ...baseSelection,
        options: [
          ...(baseSelection.options ?? []).filter((option) => option.id !== effortDescriptor.id),
          { id: effortDescriptor.id, value: requestedEffort },
        ],
      };
    }

    const runtimeMode = input.runtimeMode ?? parent.runtimeMode;
    if (!isRuntimeModeWithin(runtimeMode, parent.runtimeMode)) {
      return yield* fail(
        `runtimeMode ${runtimeMode} is more permissive than this thread's ${parent.runtimeMode}.`,
      );
    }
    const interactionMode = input.interactionMode ?? "default";
    const workspace = input.workspace ?? project.defaultThreadEnvMode ?? "worktree";
    if (workspace === "local" && (input.branch !== undefined || input.baseBranch !== undefined)) {
      return yield* fail("branch and baseBranch only apply to workspace 'worktree'.");
    }

    const gitWorkflow = yield* GitWorkflowService.GitWorkflowService;
    const checkout = yield* gitWorkflow
      .localStatus({ cwd: project.workspaceRoot })
      .pipe(Effect.option);
    const currentBranch = Option.match(checkout, {
      onNone: () => null,
      onSome: (status) => (status.isRepo ? status.refName : null),
    });
    if (workspace === "worktree" && Option.exists(checkout, (status) => !status.isRepo)) {
      return yield* fail(
        `${project.workspaceRoot} is not a git repository, so it cannot get a worktree. Use workspace 'local'.`,
      );
    }
    const baseBranch = input.baseBranch ?? currentBranch;
    if (workspace === "worktree" && baseBranch === null) {
      return yield* fail(
        "Could not find the project's current branch. Pass baseBranch explicitly.",
      );
    }

    const settings = yield* ServerSettings.ServerSettingsService;
    const { newWorktreesStartFromOrigin } = yield* settings.getSettings.pipe(
      orFailWith("Could not read Spindle settings. Try again."),
    );

    const crypto = yield* Crypto.Crypto;
    const uuid = crypto.randomUUIDv4.pipe(orFailWith("Could not generate an id. Try again."));
    const threadId = ThreadId.make(yield* uuid);
    const branchToken = yield* crypto
      .randomBytes(4)
      .pipe(orFailWith("Could not generate a branch name. Try again."));
    const createdAt = DateTime.formatIso(yield* DateTime.now);
    const { title } = input;

    const threadBootstrap = yield* ThreadBootstrap.ThreadBootstrap;
    yield* threadBootstrap
      .dispatchTurnStart({
        type: "thread.turn.start",
        commandId: CommandId.make(`server:mcp-start-thread:${yield* uuid}`),
        threadId,
        message: {
          messageId: MessageId.make(yield* uuid),
          role: "user",
          text: input.prompt,
          attachments: [],
        },
        modelSelection,
        titleSeed: title,
        runtimeMode,
        interactionMode,
        bootstrap: {
          createThread: {
            projectId: project.id,
            title,
            modelSelection,
            runtimeMode,
            interactionMode,
            branch: workspace === "local" ? currentBranch : null,
            worktreePath: null,
            parentThreadId: scope.threadId,
            createdAt,
          },
          ...(workspace === "worktree" && baseBranch !== null
            ? {
                prepareWorktree: {
                  projectCwd: project.workspaceRoot,
                  baseBranch,
                  // A temporary name is renamed from the task after the first turn,
                  // exactly like a worktree thread started from the composer.
                  branch:
                    input.branch ??
                    buildTemporaryWorktreeBranchName(() =>
                      Buffer.from(branchToken).toString("hex"),
                    ),
                  // Same default the composer applies; a base branch missing on origin
                  // falls back to the local branch.
                  ...(newWorktreesStartFromOrigin ? { startFromOrigin: true } : {}),
                },
                runSetupScript: true,
              }
            : {}),
        },
        createdAt,
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new ThreadOrchestrationError({
              message: `Could not start the thread: ${error.message}`,
            }),
        ),
      );

    return {
      threadId,
      projectId: project.id,
      workspace,
      model: toModelChoice(modelSelection),
      effort: readEffort(modelSelection, effortDescriptor),
      runtimeMode,
    };
  });

/** Messages one thread may send per hour. Guards against an agent stuck in a follow-up loop. */
export const MAX_MESSAGES_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;
const BUSY_PHASES: ReadonlySet<string> = new Set([
  "starting",
  "running",
  "waiting_for_approval",
  "waiting_for_input",
]);

/**
 * `sentAtBySender` lives for the server process. A restart resets the hourly
 * count, which is fine for a loop guard.
 */
const makeSendMessage =
  (sentAtBySender: Map<ThreadId, Array<number>>) =>
  (input: Tool.Parameters<typeof SendMessageTool>) =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const snapshot = yield* readShellSnapshot;
      const sender = snapshot.threads.find((thread) => thread.id === scope.threadId);
      const target = snapshot.threads.find((thread) => thread.id === input.threadId);
      if (!sender || !target) {
        return yield* fail(
          `Thread ${input.threadId} was not found or is archived. Call list_threads.`,
        );
      }
      if (target.parentThreadId !== scope.threadId) {
        return yield* fail(
          "You can only message threads this thread started. Call list_threads with startedByThisThread.",
        );
      }
      // Read from the snapshot, so a person sending at the same moment can still
      // slip in first; the turn start then queues behind theirs. Rare, and harmless.
      const phase = resolveThreadAwarenessPhase(target) ?? "idle";
      if (BUSY_PHASES.has(phase)) {
        return yield* fail(
          `Thread ${target.title} is ${phase.replaceAll("_", " ")}. Send the message after it finishes.`,
        );
      }

      const now = yield* DateTime.now;
      const nowMs = DateTime.toEpochMillis(now);
      const recent = (sentAtBySender.get(scope.threadId) ?? []).filter(
        (sentAt) => nowMs - sentAt < HOUR_MS,
      );
      if (recent.length >= MAX_MESSAGES_PER_HOUR) {
        return yield* fail(
          `This thread already sent ${MAX_MESSAGES_PER_HOUR} messages in the last hour. Stop and ask the user before sending more.`,
        );
      }

      const crypto = yield* Crypto.Crypto;
      const uuid = crypto.randomUUIDv4.pipe(orFailWith("Could not generate an id. Try again."));
      const sentAt = DateTime.formatIso(now);
      const threadBootstrap = yield* ThreadBootstrap.ThreadBootstrap;
      yield* threadBootstrap
        .dispatchTurnStart({
          type: "thread.turn.start",
          commandId: CommandId.make(`server:mcp-send-message:${yield* uuid}`),
          threadId: target.id,
          message: {
            messageId: MessageId.make(yield* uuid),
            role: "user",
            // Labeled so the user can tell an agent wrote it, not a person.
            text: `Message from thread "${sender.title}":\n\n${input.text}`,
            attachments: [],
          },
          modelSelection: target.modelSelection,
          runtimeMode: target.runtimeMode,
          interactionMode: target.interactionMode,
          createdAt: sentAt,
        })
        .pipe(
          Effect.mapError(
            (error) =>
              new ThreadOrchestrationError({
                message: `Could not send the message: ${error.message}`,
              }),
          ),
        );
      sentAtBySender.set(scope.threadId, [...recent, nowMs]);
      return { threadId: target.id, sentAt };
    });

export const OrchestrationToolkitHandlersLive = OrchestrationToolkit.toLayer(
  Effect.sync(() => ({
    list_projects,
    list_models,
    list_threads,
    read_thread,
    start_thread,
    send_message: makeSendMessage(new Map()),
  })),
);
