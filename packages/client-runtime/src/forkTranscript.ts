import type { CheckpointRef, MessageId, ThreadId, TurnId } from "@t3tools/contracts";
import { checkpointRefForThreadTurn } from "@t3tools/shared/git";

export interface ForkTranscriptEntry {
  readonly kind: string;
  readonly [key: string]: unknown;
  readonly message?: {
    readonly id: string;
    readonly role: "user" | "assistant" | "system";
    readonly text: string;
  };
}

/** Builds the text placed in a new draft when a chat is forked at a message. */
export function buildForkTranscript(
  sourceTitle: string,
  entries: ReadonlyArray<ForkTranscriptEntry>,
  forkPointMessageId: string,
): string | null {
  const blocks = [`Forked from ${sourceTitle}`];
  let foundForkPoint = false;

  for (const entry of entries) {
    if (entry.kind !== "message" || !entry.message) continue;

    const { message } = entry;
    if (message.role === "user" || message.role === "assistant") {
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
