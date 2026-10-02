export interface ForkTranscriptEntry {
  readonly kind: string;
  readonly [key: string]: unknown;
  readonly message?: {
    readonly id: string;
    readonly role: "user" | "assistant" | "reasoning" | "system";
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
