export interface ThreadTranscriptMessage {
  readonly role: "user" | "assistant" | "system" | "reasoning";
  readonly text: string;
}

/**
 * Builds the markdown a user gets when they copy a whole thread. Only user and
 * assistant text is included: tool calls, diffs, system notes, and provider
 * reasoning stay out so the result reads like the conversation.
 */
export function buildThreadTranscript(
  title: string,
  messages: ReadonlyArray<ThreadTranscriptMessage>,
): string {
  const blocks = [`# ${title}`];
  for (const message of messages) {
    if (message.role === "system" || message.role === "reasoning") continue;
    const text = message.text.trim();
    if (text.length === 0) continue;
    const role = message.role === "user" ? "User" : "Assistant";
    blocks.push(`**${role}:**\n${text}`);
  }
  return blocks.join("\n\n");
}
