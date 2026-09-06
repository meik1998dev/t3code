import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { getThreadTaskProgress, latestTaskSteps } from "@t3tools/shared/taskProgress";
import * as Option from "effect/Option";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { useEnvironmentThread } from "../../state/threads";
import { cn } from "../../lib/cn";

function TaskDetails({ thread }: { thread: EnvironmentThreadShell }) {
  const detail = useEnvironmentThread(thread.environmentId, thread.id);
  const data = Option.getOrNull(detail.data);
  const steps = useMemo(
    () => latestTaskSteps(data?.activities ?? [], thread.latestTurn?.turnId),
    [data?.activities, thread.latestTurn?.turnId],
  );
  if (!steps.length)
    return (
      <Text accessibilityRole="text" className="py-2 text-xs text-foreground-muted">
        {data
          ? "Task details are not available."
          : Option.isSome(detail.error)
            ? "Could not load task details."
            : "Loading tasks…"}
      </Text>
    );
  return (
    <ScrollView nestedScrollEnabled style={{ maxHeight: 208 }}>
      {steps.map((step, index) => (
        <View
          // oxlint-disable-next-line react/no-array-index-key -- Provider steps have no IDs and can repeat; rows are stateless.
          key={`${step.step}:${index}`}
          className="flex-row items-start gap-2 py-1.5"
          accessible
          accessibilityLabel={`${step.status === "completed" ? "Completed" : step.status === "inProgress" ? "In progress" : "Pending"}: ${step.step}`}
        >
          <Text
            className={cn(
              "text-xs",
              step.status === "completed"
                ? "text-adaptive-emerald-600-400"
                : step.status === "inProgress"
                  ? "text-adaptive-sky-600-400"
                  : "text-foreground-tertiary",
            )}
          >
            {step.status === "completed" ? "✓" : step.status === "inProgress" ? "●" : "○"}
          </Text>
          <Text className="flex-1 text-xs text-foreground-muted">{step.step}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

export function SidebarTasks({
  thread,
  visible,
}: {
  thread: EnvironmentThreadShell;
  visible: boolean;
}) {
  const progress = getThreadTaskProgress(thread);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const key = `${thread.environmentId}:${thread.id}:${thread.latestTurn?.turnId}`;
  if (!progress) return null;
  const expanded = expandedKey === key;
  return (
    <View className="mt-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${expanded ? "Collapse" : "Expand"} tasks: ${progress.completedSteps} of ${progress.totalSteps} complete. ${progress.step}`}
        onPress={(event) => {
          event.stopPropagation();
          setExpandedKey(expanded ? null : key);
        }}
        className="min-h-[44px] flex-row items-center gap-2"
      >
        <Text numberOfLines={1} className="min-w-0 flex-1 text-xs text-foreground-muted">
          {progress.completedSteps === progress.totalSteps ? "Plan complete" : progress.step}
        </Text>
        <View className="ml-auto flex-row items-center gap-2">
          <View
            className="flex-row items-center gap-[3px]"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {progress.stepStatuses.map((status, index) => (
              <View
                // oxlint-disable-next-line react/no-array-index-key -- These marks represent fixed checklist positions, not stateful items.
                key={`task-slot-${index}`}
                className={cn(
                  "h-2 w-[3px] rounded-full",
                  status === "completed"
                    ? "bg-adaptive-emerald-600-400"
                    : status === "inProgress"
                      ? "bg-adaptive-sky-600-400"
                      : "bg-border",
                )}
              />
            ))}
          </View>
          <Text className="text-xs tabular-nums text-foreground-tertiary">
            {progress.completedSteps}/{progress.totalSteps}
          </Text>
          <SymbolView
            name="chevron.down"
            size={10}
            tintColorClassName="accent-foreground-tertiary"
            style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
          />
        </View>
      </Pressable>
      {expanded && visible ? (
        <View className="border-t border-border">
          <TaskDetails thread={thread} />
        </View>
      ) : null}
    </View>
  );
}
