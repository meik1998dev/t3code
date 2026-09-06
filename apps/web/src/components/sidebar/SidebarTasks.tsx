import type { ScopedThreadRef } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { getThreadTaskProgress, latestTaskSteps } from "@t3tools/shared/taskProgress";
import { CheckIcon, ChevronDownIcon, CircleDotIcon, CircleIcon } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useThreadDetail, useThreadStatus } from "../../state/entities";
import { cn } from "../../lib/utils";

function TaskDetails({
  threadRef,
  latestTurn,
}: {
  threadRef: ScopedThreadRef;
  latestTurn: EnvironmentThreadShell["latestTurn"];
}) {
  // Mounting the drawer, not a sidebar row, acquires the detail subscription.
  const detail = useThreadDetail(threadRef);
  const status = useThreadStatus(threadRef);
  const steps = useMemo(
    () => latestTaskSteps(detail?.activities ?? [], latestTurn?.turnId),
    [detail?.activities, latestTurn?.turnId],
  );
  if (steps.length === 0) {
    return (
      <p role="status" className="py-2 text-[11px] text-muted-foreground">
        {status === "empty" || status === "synchronizing"
          ? "Loading tasks…"
          : "Task details are not available."}
      </p>
    );
  }
  return (
    <ul aria-label="Task list" className="max-h-52 overflow-y-auto overscroll-contain py-1">
      {steps.map((step, index) => {
        const Icon =
          step.status === "completed"
            ? CheckIcon
            : step.status === "inProgress"
              ? CircleDotIcon
              : CircleIcon;
        return (
          <li // oxlint-disable-next-line react/no-array-index-key -- Provider steps have no IDs and can repeat; rows are stateless.
            key={`${step.step}:${index}`}
            className="flex items-start gap-2 py-1.5 text-[11px]"
          >
            <Icon
              aria-hidden
              className={cn(
                "mt-0.5 size-3 shrink-0",
                step.status === "completed"
                  ? "text-success"
                  : step.status === "inProgress"
                    ? "text-sky-600 dark:text-sky-400"
                    : "text-muted-foreground/50",
              )}
            />
            <span className="sr-only">
              {step.status === "completed"
                ? "Completed: "
                : step.status === "inProgress"
                  ? "In progress: "
                  : "Pending: "}
            </span>
            <span
              className={cn(
                "min-w-0 break-words",
                step.status === "inProgress" ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {step.step}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function SidebarTasks({
  thread,
  threadRef,
  leaseLiveStatus,
}: {
  thread: EnvironmentThreadShell;
  threadRef: ScopedThreadRef;
  leaseLiveStatus: boolean;
}) {
  const progress = getThreadTaskProgress(thread);
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null);
  const id = useId();
  if (!progress) return null;
  const expanded = expandedTurnId === thread.latestTurn?.turnId;
  const complete = progress.completedSteps === progress.totalSteps;
  return (
    <div
      className="mt-1"
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={id}
        aria-label={`${expanded ? "Collapse" : "Expand"} tasks: ${progress.completedSteps} of ${progress.totalSteps} complete. ${progress.step}`}
        onClick={() => setExpandedTurnId(expanded ? null : (thread.latestTurn?.turnId ?? null))}
        className="flex min-h-8 w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1 truncate text-[11px] text-foreground/80">
          {complete ? "Plan complete" : progress.step}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span aria-hidden className="flex items-center gap-[3px]">
            {progress.stepStatuses.map((status, index) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- These marks represent fixed checklist positions, not stateful items.
                key={`task-slot-${index}`}
                className={cn(
                  "h-2 w-[3px] rounded-full",
                  status === "completed"
                    ? "bg-success"
                    : status === "inProgress"
                      ? "bg-sky-600 dark:bg-sky-400"
                      : "bg-muted-foreground/25",
                )}
              />
            ))}
          </span>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {progress.completedSteps}/{progress.totalSteps}
          </span>
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "size-3 text-muted-foreground transition-transform motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </span>
      </button>
      <div id={id} hidden={!expanded} className="border-t border-border/50">
        {expanded && leaseLiveStatus ? (
          <TaskDetails threadRef={threadRef} latestTurn={thread.latestTurn} />
        ) : null}
      </div>
    </div>
  );
}
