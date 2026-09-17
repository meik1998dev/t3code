import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as NodeServices from "@effect/platform-node/NodeServices";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const now = "2026-01-01T00:00:00.000Z";
const projectId = ProjectId.make("project-parent");

const createThread = (id: string, parentThreadId?: string) =>
  ({
    type: "thread.create",
    commandId: CommandId.make(`cmd-create-${id}`),
    threadId: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    ...(parentThreadId ? { parentThreadId: ThreadId.make(parentThreadId) } : {}),
    createdAt: now,
  }) satisfies OrchestrationCommand;

/** Decide a command and fold its events into the read model, like the engine does. */
const apply = (readModel: OrchestrationReadModel, command: OrchestrationCommand) =>
  Effect.gen(function* () {
    const decided = yield* decideOrchestrationCommand({ command, readModel });
    let next = readModel;
    for (const event of Array.isArray(decided) ? decided : [decided]) {
      next = yield* projectEvent(next, { ...event, sequence: next.snapshotSequence + 1 });
    }
    return next;
  });

const withPersonAndChild = Effect.gen(function* () {
  let readModel = yield* apply(createEmptyReadModel(now), {
    type: "project.create",
    commandId: CommandId.make("cmd-project"),
    projectId,
    title: "Parent",
    workspaceRoot: "/tmp/parent",
    defaultModelSelection: null,
    createdAt: now,
  });
  readModel = yield* apply(readModel, createThread("thread-person"));
  return yield* apply(readModel, createThread("thread-child", "thread-person"));
});

it.layer(NodeServices.layer)("decider thread parents", (it) => {
  it.effect("accepts a thread a person started as parent", () =>
    Effect.gen(function* () {
      const readModel = yield* withPersonAndChild;
      expect(readModel.threads.find((thread) => thread.id === "thread-child")?.parentThreadId).toBe(
        "thread-person",
      );
    }),
  );

  it.effect.each([
    { name: "an unknown parent", parent: "thread-missing", detail: "does not exist" },
    { name: "the thread itself", parent: "thread-new", detail: "cannot be its own parent" },
    { name: "a parent an agent started", parent: "thread-child", detail: "cannot start threads" },
  ])("rejects $name", ({ parent, detail }) =>
    Effect.gen(function* () {
      const readModel = yield* withPersonAndChild;
      const error = yield* decideOrchestrationCommand({
        command: createThread("thread-new", parent),
        readModel,
      }).pipe(Effect.flip);
      expect(error.message).toContain(detail);
    }),
  );
});
