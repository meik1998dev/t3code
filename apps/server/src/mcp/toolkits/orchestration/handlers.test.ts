import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  OrchestrationCheckpointSummary,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";

import * as GitWorkflowService from "../../../git/GitWorkflowService.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBootstrap from "../../../orchestration/ThreadBootstrap.ts";
import * as ProviderRegistry from "../../../provider/Services/ProviderRegistry.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { MAX_MESSAGES_PER_HOUR } from "./handlers.ts";

const now = "2026-01-01T00:00:00.000Z";
const parentThreadId = ThreadId.make("thread-parent");
const decodeProject = Schema.decodeUnknownSync(OrchestrationProjectShell);
const decodeThread = Schema.decodeUnknownSync(OrchestrationThreadShell);
const decodeCheckpoint = Schema.decodeUnknownSync(OrchestrationCheckpointSummary);

const checkpoint = (turn: number, files: ReadonlyArray<[string, number, number]>) =>
  decodeCheckpoint({
    turnId: `turn-${turn}`,
    checkpointTurnCount: turn,
    checkpointRef: `refs/t3/checkpoints/${turn}`,
    status: "ready",
    files: files.map(([path, additions, deletions]) => ({
      path,
      kind: "modified",
      additions,
      deletions,
    })),
    assistantMessageId: null,
    completedAt: now,
  });

const project = decodeProject({
  id: "project-1",
  title: "Repo",
  workspaceRoot: "/repo",
  defaultModelSelection: null,
  scripts: [],
  createdAt: now,
  updatedAt: now,
});

const makeThread = (input: {
  readonly id: string;
  readonly parentThreadId?: string;
  readonly runtimeMode?: string;
  readonly updatedAt?: string;
  readonly session?: unknown;
  readonly worktreePath?: string;
}) =>
  decodeThread({
    id: input.id,
    projectId: project.id,
    title: `Thread ${input.id}`,
    modelSelection: { instanceId: "codex", model: "gpt-5.5" },
    runtimeMode: input.runtimeMode ?? "auto-accept-edits",
    branch: "main",
    worktreePath: input.worktreePath ?? null,
    parentThreadId: input.parentThreadId ?? null,
    latestTurn: null,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
    session: input.session ?? null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  });

const provider = (instanceId: string, overrides: Partial<ServerProvider> = {}): ServerProvider => ({
  instanceId: ProviderInstanceId.make(instanceId),
  driver: ProviderDriverKind.make(instanceId),
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: now,
  models: [
    {
      slug: `${instanceId}-model`,
      name: `${instanceId} model`,
      isCustom: false,
      capabilities: null,
    },
  ],
  slashCommands: [],
  skills: [],
  ...overrides,
});

// Codex-shaped model with a reasoning effort picker, matching the parent thread's model.
const codexWithEffort = provider("codex", {
  models: [
    {
      slug: "gpt-5.5",
      name: "GPT-5.5",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
        ],
      },
    },
  ],
});

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "orchestration-test", version: "1.0.0" },
  },
  getClient: Effect.die("unused"),
});

const invocation = (capabilities: ReadonlyArray<McpInvocationContext.McpCapability>) => ({
  environmentId: EnvironmentId.make("environment-test"),
  threadId: parentThreadId,
  providerSessionId: "provider-session-test",
  providerInstanceId: ProviderInstanceId.make("codex"),
  capabilities: new Set(capabilities),
  issuedAt: 1,
});

const makeHarness = (options: {
  readonly threads?: ReadonlyArray<OrchestrationThreadShell>;
  readonly providers?: ReadonlyArray<ServerProvider>;
  readonly isRepo?: boolean;
  readonly routingNotes?: string;
  readonly startFromOrigin?: boolean;
  readonly checkpoints?: Readonly<Record<string, ReadonlyArray<OrchestrationCheckpointSummary>>>;
}) => {
  const dispatched: Array<ThreadBootstrap.ThreadTurnStartCommand> = [];
  const threads = options.threads ?? [makeThread({ id: parentThreadId })];
  const layer = McpHttpServer.OrchestrationToolkitRegistrationLive.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(
      Layer.mock(ProjectionSnapshotQuery.ProjectionSnapshotQuery)({
        getShellSnapshot: () =>
          Effect.succeed({
            snapshotSequence: 1,
            projects: [project],
            threads,
            updatedAt: now,
          }),
        getThreadShellById: (threadId) =>
          Effect.succeed(Option.fromNullishOr(threads.find((thread) => thread.id === threadId))),
        getThreadCheckpointContext: (threadId) =>
          Effect.succeed(
            Option.map(
              Option.fromNullishOr(threads.find((thread) => thread.id === threadId)),
              (thread) => ({
                threadId: thread.id,
                projectId: thread.projectId,
                workspaceRoot: project.workspaceRoot,
                worktreePath: thread.worktreePath,
                checkpoints: options.checkpoints?.[thread.id] ?? [],
              }),
            ),
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed(options.providers ?? [provider("codex"), provider("claude")]),
      }),
    ),
    Layer.provide(
      Layer.mock(GitWorkflowService.GitWorkflowService)({
        localStatus: () =>
          Effect.succeed({
            isRepo: options.isRepo ?? true,
            hasPrimaryRemote: true,
            isDefaultRef: true,
            refName: options.isRepo === false ? null : "main",
            hasWorkingTreeChanges: false,
            workingTree: { files: [], insertions: 0, deletions: 0 },
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(ThreadBootstrap.ThreadBootstrap)({
        dispatchTurnStart: (command) =>
          Effect.sync(() => {
            dispatched.push(command);
            return { sequence: dispatched.length };
          }),
      }),
    ),
    Layer.provide(
      ServerSettings.layerTest({
        threadRoutingNotes: options.routingNotes ?? "",
        newWorktreesStartFromOrigin: options.startFromOrigin ?? true,
      }),
    ),
    Layer.provide(NodeServices.layer),
  );
  const callTool = (
    name: string,
    args: Record<string, unknown>,
    capabilities: ReadonlyArray<McpInvocationContext.McpCapability> = ["preview", "orchestration"],
  ) =>
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      return yield* server
        .callTool({ name, arguments: args })
        .pipe(
          Effect.provideService(
            McpInvocationContext.McpInvocationContext,
            invocation(capabilities),
          ),
          Effect.provideService(McpSchema.McpServerClient, client),
        );
    });
  // Each `call` builds a fresh server. Use `withServer` when calls must share handler state.
  const call = (...args: Parameters<typeof callTool>) =>
    callTool(...args).pipe(Effect.provide(layer));
  const withServer = <A, E>(effect: Effect.Effect<A, E, McpServer.McpServer>) =>
    effect.pipe(Effect.provide(layer));
  return { dispatched, call, callTool, withServer };
};

const errorText = (result: McpSchema.CallToolResult) =>
  result.content.map((part) => ("text" in part ? part.text : "")).join("");

describe("orchestration MCP tools", () => {
  it.effect("without orchestration, reading threads works but starting them is refused", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      for (const name of ["list_projects", "list_models"]) {
        const result = yield* harness.call(name, {}, ["preview"]);
        expect(result.isError).toBe(true);
        expect(errorText(result)).toContain("cannot start other threads");
      }
      const list = yield* harness.call("list_threads", {}, ["preview"]);
      expect(list.isError).toBe(false);
      const read = yield* harness.call("read_thread", { threadId: parentThreadId }, ["preview"]);
      expect(read.isError).toBe(false);
      const start = yield* harness.call(
        "start_thread",
        { projectId: project.id, title: "Backend", prompt: "Build the API" },
        ["preview"],
      );
      expect(start.isError).toBe(true);
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("lists only usable providers", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        providers: [provider("codex"), provider("cursor", { enabled: false })],
      });
      const result = yield* harness.call("list_models", {});
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toEqual({
        routingNotes: "",
        providers: [
          {
            instanceId: "codex",
            driver: "codex",
            status: "ready",
            models: [
              { slug: "codex-model", name: "codex model", isDefault: false, effortOptions: [] },
            ],
          },
        ],
      });
    }),
  );

  it.effect("returns the user's routing notes and each model's effort choices", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        providers: [codexWithEffort],
        routingNotes: "Fable: hard bugs. Flash: docs.",
      });
      const result = yield* harness.call("list_models", {});
      expect(result.structuredContent).toMatchObject({
        routingNotes: "Fable: hard bugs. Flash: docs.",
        providers: [{ models: [{ slug: "gpt-5.5", effortOptions: ["low", "high"] }] }],
      });
    }),
  );

  it.effect("applies a requested effort as the model's own effort option", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ providers: [codexWithEffort] });
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Rename",
        prompt: "Rename the helper",
        model: { instanceId: "codex", model: "gpt-5.5" },
        effort: "low",
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({ effort: "low" });
      expect(harness.dispatched[0]?.modelSelection).toEqual({
        instanceId: "codex",
        model: "gpt-5.5",
        options: [{ id: "reasoningEffort", value: "low" }],
      });
    }),
  );

  it.effect("keeps this thread's effort when the child uses the same model", () =>
    Effect.gen(function* () {
      const parent = {
        ...makeThread({ id: parentThreadId }),
        modelSelection: {
          instanceId: ProviderInstanceId.make("codex"),
          model: "gpt-5.5",
          options: [{ id: "reasoningEffort", value: "high" }],
        },
      };
      const harness = makeHarness({ providers: [codexWithEffort], threads: [parent] });
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Fix",
        prompt: "Fix the bug",
        model: { instanceId: "codex", model: "gpt-5.5" },
      });
      expect(result.structuredContent).toMatchObject({ effort: "high" });
    }),
  );

  it.effect("rejects an effort the model does not offer and names the allowed values", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ providers: [codexWithEffort] });
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Task",
        prompt: "Do it",
        effort: "max",
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("Use one of: low, high");
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("lists threads newest first and filters to this thread's children", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        threads: [
          makeThread({ id: parentThreadId }),
          makeThread({ id: "thread-other", updatedAt: "2026-01-03T00:00:00.000Z" }),
          makeThread({
            id: "thread-child",
            parentThreadId,
            updatedAt: "2026-01-02T00:00:00.000Z",
            session: {
              threadId: "thread-child",
              status: "running",
              providerName: "codex",
              activeTurnId: null,
              lastError: null,
              updatedAt: now,
            },
          }),
        ],
      });
      const all = yield* harness.call("list_threads", {});
      expect(
        (all.structuredContent as { threads: Array<{ id: string }> }).threads.map(
          (thread) => thread.id,
        ),
      ).toEqual(["thread-other", "thread-child", parentThreadId]);

      const children = yield* harness.call("list_threads", { startedByThisThread: true });
      expect(children.structuredContent).toMatchObject({
        threads: [{ id: "thread-child", parentThreadId, status: "running" }],
      });
    }),
  );

  it.effect("reads a thread's details and the files its turns changed, without the chat", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        checkpoints: {
          [parentThreadId]: [
            checkpoint(1, [["src/api.ts", 10, 2]]),
            checkpoint(2, [
              ["src/api.ts", 3, 1],
              ["src/routes.ts", 5, 0],
            ]),
          ],
        },
      });
      const result = yield* harness.call("read_thread", { threadId: parentThreadId });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        id: parentThreadId,
        branch: "main",
        // A local thread's files live in the project checkout.
        workspacePath: "/repo",
        changedFiles: [
          { path: "src/api.ts", additions: 13, deletions: 3 },
          { path: "src/routes.ts", additions: 5, deletions: 0 },
        ],
      });
      expect(result.structuredContent).not.toHaveProperty("messages");
    }),
  );

  it.effect("points a reviewer at a worktree thread's own folder, where uncommitted work is", () =>
    Effect.gen(function* () {
      const worktreeThread = makeThread({
        id: "thread-worktree",
        worktreePath: "/repo/.t3/worktrees/feature",
      });
      const harness = makeHarness({
        threads: [makeThread({ id: parentThreadId }), worktreeThread],
      });
      const result = yield* harness.call("read_thread", { threadId: "thread-worktree" });
      expect(result.structuredContent).toMatchObject({
        workspacePath: "/repo/.t3/worktrees/feature",
      });
    }),
  );

  it.effect("sends a labeled follow-up to an idle child with the child's own settings", () =>
    Effect.gen(function* () {
      const child = makeThread({
        id: "thread-child",
        parentThreadId,
        runtimeMode: "approval-required",
      });
      const harness = makeHarness({ threads: [makeThread({ id: parentThreadId }), child] });
      const result = yield* harness.call("send_message", {
        threadId: "thread-child",
        text: "Also handle empty arrays.",
      });
      expect(result.isError).toBe(false);
      const [command] = harness.dispatched;
      expect(command?.threadId).toBe("thread-child");
      expect(command?.message.text).toBe(
        `Message from thread "Thread ${parentThreadId}":\n\nAlso handle empty arrays.`,
      );
      expect(command?.runtimeMode).toBe("approval-required");
      expect(command?.bootstrap).toBeUndefined();
    }),
  );

  it.effect("refuses to message a thread this thread did not start", () =>
    Effect.gen(function* () {
      const harness = makeHarness({
        threads: [makeThread({ id: parentThreadId }), makeThread({ id: "thread-user" })],
      });
      const result = yield* harness.call("send_message", { threadId: "thread-user", text: "Hi" });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("only message threads this thread started");
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("refuses while the child is busy instead of queueing", () =>
    Effect.gen(function* () {
      const busyChild = makeThread({
        id: "thread-child",
        parentThreadId,
        session: {
          threadId: "thread-child",
          status: "running",
          providerName: "codex",
          activeTurnId: null,
          lastError: null,
          updatedAt: now,
        },
      });
      const harness = makeHarness({ threads: [makeThread({ id: parentThreadId }), busyChild] });
      const result = yield* harness.call("send_message", { threadId: "thread-child", text: "Hi" });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("is running");
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("stops a thread after the hourly message limit", () =>
    Effect.gen(function* () {
      const child = makeThread({ id: "thread-child", parentThreadId });
      const harness = makeHarness({ threads: [makeThread({ id: parentThreadId }), child] });
      const results = yield* harness.withServer(
        Effect.forEach(Array.from({ length: MAX_MESSAGES_PER_HOUR + 1 }), (_, index) =>
          harness.callTool("send_message", { threadId: "thread-child", text: `Step ${index}` }),
        ),
      );
      expect(results.slice(0, MAX_MESSAGES_PER_HOUR).every((result) => !result.isError)).toBe(true);
      const last = results.at(-1);
      expect(last?.isError).toBe(true);
      expect(last ? errorText(last) : "").toContain("messages in the last hour");
      expect(harness.dispatched).toHaveLength(MAX_MESSAGES_PER_HOUR);
    }),
  );

  it.effect("reports an unknown thread instead of returning empty data", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const result = yield* harness.call("read_thread", { threadId: "thread-missing" });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("was not found");
    }),
  );

  it.effect("starts a worktree thread from the current branch with this thread as parent", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Backend",
        prompt: "Build the API",
        model: { instanceId: "claude", model: "claude-model" },
      });
      expect(result.isError).toBe(false);
      expect(result.structuredContent).toMatchObject({
        projectId: project.id,
        workspace: "worktree",
        model: { instanceId: "claude", model: "claude-model" },
        runtimeMode: "auto-accept-edits",
      });

      expect(harness.dispatched).toHaveLength(1);
      const [command] = harness.dispatched;
      expect(command?.message.text).toBe("Build the API");
      expect(command?.bootstrap?.createThread).toMatchObject({
        projectId: project.id,
        title: "Backend",
        modelSelection: { instanceId: "claude", model: "claude-model" },
        runtimeMode: "auto-accept-edits",
        parentThreadId,
        worktreePath: null,
      });
      expect(command?.bootstrap?.prepareWorktree).toMatchObject({
        projectCwd: "/repo",
        baseBranch: "main",
        // "New worktrees start from origin" is on by default.
        startFromOrigin: true,
      });
      // Unnamed branches get the same temporary name the composer uses, which
      // the server renames from the task after the first turn.
      expect(command?.bootstrap?.prepareWorktree?.branch).toMatch(/^[0-9a-f]{8}$/);
      expect(command?.bootstrap?.runSetupScript).toBe(true);
    }),
  );

  it.effect("starts a worktree from the local branch when start from origin is off", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ startFromOrigin: false });
      yield* harness.call("start_thread", { projectId: project.id, title: "T", prompt: "Do it" });
      expect(harness.dispatched[0]?.bootstrap?.prepareWorktree?.startFromOrigin).toBeUndefined();
    }),
  );

  it.effect("starts a local thread in the project checkout", () =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Docs",
        prompt: "Update the docs",
        workspace: "local",
      });
      expect(result.isError).toBe(false);
      const [command] = harness.dispatched;
      expect(command?.bootstrap?.createThread).toMatchObject({
        branch: "main",
        worktreePath: null,
      });
      expect(command?.bootstrap?.prepareWorktree).toBeUndefined();
      expect(command?.modelSelection).toEqual({ instanceId: "codex", model: "gpt-5.5" });
    }),
  );

  it.effect.each([
    {
      name: "a more permissive runtime mode",
      args: { runtimeMode: "full-access" },
      message: "more permissive",
    },
    {
      name: "an unknown project",
      args: { projectId: "project-missing" },
      message: "was not found",
    },
    {
      name: "a model the provider does not offer",
      args: { model: { instanceId: "codex", model: "made-up" } },
      message: "is not offered",
    },
    {
      name: "a branch in local mode",
      args: { workspace: "local", branch: "feature/x" },
      message: "only apply to workspace 'worktree'",
    },
  ])("rejects $name without starting anything", ({ args, message }) =>
    Effect.gen(function* () {
      const harness = makeHarness({});
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Task",
        prompt: "Do it",
        ...args,
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain(message);
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("rejects a worktree for a project that is not a git repository", () =>
    Effect.gen(function* () {
      const harness = makeHarness({ isRepo: false });
      const result = yield* harness.call("start_thread", {
        projectId: project.id,
        title: "Task",
        prompt: "Do it",
      });
      expect(result.isError).toBe(true);
      expect(errorText(result)).toContain("not a git repository");
      expect(harness.dispatched).toEqual([]);
    }),
  );

  it.effect("stops at the active child limit, and settling a child frees a slot", () =>
    Effect.gen(function* () {
      const children = Array.from({ length: 5 }, (_, index) =>
        makeThread({ id: `thread-child-${index}`, parentThreadId }),
      );
      const full = makeHarness({ threads: [makeThread({ id: parentThreadId }), ...children] });
      const args = { projectId: project.id, title: "One more", prompt: "Do it" };
      const refused = yield* full.call("start_thread", args);
      expect(refused.isError).toBe(true);
      expect(errorText(refused)).toContain("already has 5 active threads");
      expect(full.dispatched).toEqual([]);

      const [first, ...rest] = children;
      const withSettled = makeHarness({
        threads: [
          makeThread({ id: parentThreadId }),
          ...(first ? [{ ...first, settledOverride: "settled" as const, settledAt: now }] : []),
          ...rest,
        ],
      });
      const accepted = yield* withSettled.call("start_thread", args);
      expect(accepted.isError).toBe(false);
      expect(withSettled.dispatched).toHaveLength(1);
    }),
  );
});
