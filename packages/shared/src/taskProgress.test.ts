import { describe, expect, it } from "vite-plus/test";
import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import {
  getThreadTaskProgress,
  latestTaskSteps,
  summarizeTaskProgress,
  taskStepsFromPayload,
} from "./taskProgress";

const turnId = TurnId.make("turn-1");
const steps = [
  { step: "First", status: "completed" },
  { step: "Second", status: "pending" },
  { step: "Third", status: "inProgress" },
] as const;
const activity = (sequence: number, plan: unknown, turn = turnId): OrchestrationThreadActivity => ({
  id: EventId.make(`activity-${sequence}`),
  kind: "turn.plan.updated",
  tone: "info",
  summary: "Plan",
  payload: { plan },
  sequence,
  turnId: turn,
  createdAt: "2026-09-06T00:00:00Z",
});

describe("sidebar task progress", () => {
  it("preserves nonsequential states and prioritizes active work", () => {
    expect(summarizeTaskProgress(turnId, steps)).toEqual({
      turnId,
      step: "Third",
      completedSteps: 1,
      totalSteps: 3,
      stepStatuses: ["completed", "pending", "inProgress"],
    });
  });
  it("retains a finished plan without inventing a thread completion", () => {
    expect(summarizeTaskProgress(turnId, [{ step: "Done", status: "completed" }])).toEqual({
      turnId,
      step: "Done",
      completedSteps: 1,
      totalSteps: 1,
      stepStatuses: ["completed"],
    });
    expect(summarizeTaskProgress(turnId, [])).toBeNull();
  });
  it("bounds the marks for large plans while retaining exact counts", () => {
    const plan = Array.from({ length: 100 }, (_, index) => ({
      step: `Task ${index}`,
      status: "pending" as const,
    }));
    expect(summarizeTaskProgress(turnId, plan)).toMatchObject({
      totalSteps: 100,
      stepStatuses: [],
    });
  });
  it("selects the latest matching turn snapshot and honors an empty reset", () => {
    expect(latestTaskSteps([activity(2, steps), activity(1, [])], turnId)).toEqual(steps);
    expect(latestTaskSteps([activity(2, steps), activity(3, [])], turnId)).toEqual([]);
    expect(latestTaskSteps([activity(2, steps)], TurnId.make("other"))).toEqual([]);
    expect(taskStepsFromPayload({ plan: [{ step: "Bad", status: "invalid" }] })).toEqual([]);
  });
  it("does not expose a previous turn's tasks and supports older servers", () => {
    const progress = summarizeTaskProgress(turnId, steps);
    expect(getThreadTaskProgress({ latestTurn: null, taskProgress: progress })).toBeNull();
    expect(
      getThreadTaskProgress({
        latestTurn: null,
        planProgress: { step: "Legacy", completedSteps: 1, totalSteps: 3 },
      }),
    ).toEqual({ step: "Legacy", completedSteps: 1, totalSteps: 3, stepStatuses: [] });
    expect(
      getThreadTaskProgress({
        latestTurn: null,
        taskProgress: null,
        planProgress: { step: "Stale", completedSteps: 1, totalSteps: 3 },
      }),
    ).toBeNull();
  });
});
