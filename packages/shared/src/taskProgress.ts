import {
  ThreadTaskStep,
  type OrchestrationThreadActivity,
  type OrchestrationThreadShell,
  type ThreadTaskProgress,
  type TurnId,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export const MAX_SIDEBAR_TASK_MARKS = 12;
const decodePlan = Schema.decodeUnknownOption(
  Schema.Struct({ plan: Schema.Array(ThreadTaskStep) }),
);

export function taskStepsFromPayload(payload: unknown): readonly ThreadTaskStep[] {
  const decoded = decodePlan(payload);
  return Option.isSome(decoded) ? decoded.value.plan : [];
}

export function summarizeTaskProgress(
  turnId: TurnId,
  steps: readonly ThreadTaskStep[],
): ThreadTaskProgress | null {
  const current =
    steps.find((step) => step.status === "inProgress") ??
    steps.find((step) => step.status === "pending") ??
    steps.at(-1);
  if (!current) return null;
  return {
    turnId,
    step: current.step,
    completedSteps: steps.filter((step) => step.status === "completed").length,
    totalSteps: steps.length,
    // Large plans use the count instead of implying that twelve marks cover
    // an arbitrarily long checklist.
    stepStatuses: steps.length <= MAX_SIDEBAR_TASK_MARKS ? steps.map((step) => step.status) : [],
  };
}

/** Reject stale summaries when a new turn begins or a cached shell is merged. */
export function getThreadTaskProgress(
  thread: Pick<OrchestrationThreadShell, "taskProgress" | "latestTurn" | "planProgress">,
) {
  if (thread.taskProgress !== undefined) {
    return thread.taskProgress?.turnId === thread.latestTurn?.turnId ? thread.taskProgress : null;
  }
  // Older environments only publish the current step and counts. Do not
  // invent per-step states or fetch every thread just to fill the strip.
  return thread.planProgress && thread.planProgress.totalSteps > 0
    ? { ...thread.planProgress, stepStatuses: [] }
    : null;
}

/** The latest snapshot wins, including an explicit empty list. */
export function latestTaskSteps(
  activities: readonly OrchestrationThreadActivity[],
  turnId: TurnId | null | undefined,
): readonly ThreadTaskStep[] {
  if (!turnId) return [];
  let latest: OrchestrationThreadActivity | undefined;
  for (const activity of activities) {
    if (activity.kind !== "turn.plan.updated" || activity.turnId !== turnId) continue;
    if (
      !latest ||
      (activity.sequence ?? 0) > (latest.sequence ?? 0) ||
      ((activity.sequence ?? 0) === (latest.sequence ?? 0) &&
        (activity.createdAt > latest.createdAt ||
          (activity.createdAt === latest.createdAt && activity.id > latest.id)))
    ) {
      latest = activity;
    }
  }
  return latest ? taskStepsFromPayload(latest.payload) : [];
}
