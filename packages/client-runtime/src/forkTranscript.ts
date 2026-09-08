import type { CheckpointRef, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { checkpointRefForThreadTurn } from "@t3tools/shared/git";

export interface ForkTranscriptEntry {
  readonly kind: string;
  readonly [key: string]: unknown;
  readonly message?: {
    readonly id: string;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
    readonly createdAt?: string;
  };
}

export interface ForkTranscriptOptions {
  /**
   * ISO timestamp of a context compaction. Messages created at or before it
   * are left out, so the new draft only carries the part of the chat the
   * agent still had in context after compacting.
   */
  readonly afterCompactionAt?: string | null;
}

/** Builds the text placed in a new draft when a chat is forked at a message. */
export function buildForkTranscript(
  sourceTitle: string,
  entries: ReadonlyArray<ForkTranscriptEntry>,
  forkPointMessageId: string,
  options?: ForkTranscriptOptions,
): string | null {
  const afterCompactionAt = options?.afterCompactionAt ?? null;
  const blocks = [
    afterCompactionAt
      ? `Forked from ${sourceTitle} after a context compaction. Earlier messages are not included.`
      : `Forked from ${sourceTitle}`,
  ];
  let foundForkPoint = false;

  for (const entry of entries) {
    if (entry.kind !== "message" || !entry.message) continue;

    const { message } = entry;
    const isBeforeCompaction =
      afterCompactionAt !== null &&
      message.createdAt !== undefined &&
      message.createdAt <= afterCompactionAt;
    if (!isBeforeCompaction && (message.role === "user" || message.role === "assistant")) {
      const role = message.role === "user" ? "User" : "Assistant";
      blocks.push(`**${role}:**\n${message.text}`);
    }

    if (message.id === forkPointMessageId) {
      foundForkPoint = true;
      break;
    }
  }

  return foundForkPoint ? blocks.join("\n\n") : null;
}

export interface ForkCheckpointMessage {
  readonly id: MessageId;
  readonly role: "user" | "assistant" | "system";
  readonly turnId: TurnId | null;
}

export interface ForkCheckpointSummary {
  readonly turnId: TurnId;
  readonly checkpointTurnCount: number;
  readonly checkpointRef: CheckpointRef;
  readonly status: "ready" | "missing" | "error";
  readonly assistantMessageId: MessageId | null;
}

/** Resolves the file checkpoint represented by a user or assistant message. */
export function resolveForkPointCheckpointRef(
  threadId: ThreadId,
  message: ForkCheckpointMessage,
  checkpoints: ReadonlyArray<ForkCheckpointSummary>,
): CheckpointRef | null {
  if (message.role === "assistant") {
    return (
      checkpoints.findLast(
        (checkpoint) =>
          checkpoint.status === "ready" &&
          (checkpoint.assistantMessageId === message.id || checkpoint.turnId === message.turnId),
      )?.checkpointRef ?? null
    );
  }
  if (message.role !== "user" || message.turnId === null) return null;

  const turnCheckpoint = checkpoints.findLast((checkpoint) => checkpoint.turnId === message.turnId);
  if (!turnCheckpoint) return null;

  const previousTurnCount = Math.max(0, turnCheckpoint.checkpointTurnCount - 1);
  if (previousTurnCount === 0) {
    return checkpointRefForThreadTurn(threadId, 0);
  }
  return (
    checkpoints.findLast(
      (checkpoint) =>
        checkpoint.status === "ready" && checkpoint.checkpointTurnCount === previousTurnCount,
    )?.checkpointRef ?? null
  );
}

export interface ForkCompactionActivity {
  readonly kind: string;
  readonly createdAt: string;
}

/**
 * Finds the latest context compaction that happened at or before the fork
 * point message. Returns null when the chat was never compacted before it.
 */
export function resolveLatestCompactionAt(
  activities: ReadonlyArray<ForkCompactionActivity>,
  forkPointCreatedAt: string,
): string | null {
  let latest: string | null = null;
  for (const activity of activities) {
    if (activity.kind !== "context-compaction") continue;
    if (activity.createdAt > forkPointCreatedAt) continue;
    if (latest === null || activity.createdAt > latest) latest = activity.createdAt;
  }
  return latest;
}
