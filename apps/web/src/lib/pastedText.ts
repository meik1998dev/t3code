/**
 * A large clipboard paste is folded into one composer chip instead of
 * flooding the editor. The prompt string keeps the full text between two
 * invisible marker characters, so drafts, cursor math and persistence need
 * no extra state. The markers are stripped when the prompt leaves the client
 * (see `stripPastedTextMarkers`).
 */
export const PASTED_TEXT_START = "\uFFF9";
export const PASTED_TEXT_END = "\uFFFB";

const COMPACT_MIN_LINES = 8;
const COMPACT_MIN_CHARS = 1000;
const PREVIEW_MAX_LINES = 8;
const PREVIEW_MAX_CHARS = 400;

export function countPastedTextLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  let count = 1;
  for (const char of text) {
    if (char === "\n") {
      count += 1;
    }
  }
  return count;
}

export function shouldCompactPastedText(text: string): boolean {
  return text.length >= COMPACT_MIN_CHARS || countPastedTextLines(text) >= COMPACT_MIN_LINES;
}

export function stripPastedTextMarkers(prompt: string): string {
  return prompt.replaceAll(PASTED_TEXT_START, "").replaceAll(PASTED_TEXT_END, "");
}

/** Wrap pasted content so `splitPromptIntoComposerSegments` sees one atomic chip. */
export function serializePastedText(text: string): string {
  return `${PASTED_TEXT_START}${stripPastedTextMarkers(text.replace(/\r\n/g, "\n"))}${PASTED_TEXT_END}`;
}

export function formatPastedTextLabel(text: string): string {
  const lines = countPastedTextLines(text);
  if (lines > 1) {
    return `Pasted text · ${lines} lines`;
  }
  return `Pasted text · ${text.length.toLocaleString("en-US")} characters`;
}

export function previewPastedText(text: string): string {
  const lines = text.split("\n");
  const visibleLines = lines.slice(0, PREVIEW_MAX_LINES);
  let preview = visibleLines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS);
  }
  return preview.length < text.length ? `${preview}…` : preview;
}
