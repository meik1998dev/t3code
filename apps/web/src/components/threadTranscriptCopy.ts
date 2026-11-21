import { msg } from "gt-react";
import { buildThreadTranscript } from "@t3tools/client-runtime/thread-transcript";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { namedClipboardTarget, writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { m } from "../i18n/messages";
import { loadFullThreadHistory } from "../state/threads";
import { stackedThreadToast, toastManager } from "./ui/toast";

/**
 * Copies a whole thread as markdown. The sidebar only holds a window of turns,
 * so the full history is fetched first; the loading toast covers that wait on
 * long threads and then flips to the result.
 */
export async function copyThreadTranscript(threadRef: ScopedThreadRef, title: string) {
  const toastId = toastManager.add({
    type: "loading",
    title: m(msg("Copying transcript…")),
    description: title,
    timeout: 0,
  });
  try {
    const projection = await loadFullThreadHistory(threadRef);
    const transcript = buildThreadTranscript(projection.thread.title, projection.messages);
    await writeTextToClipboard(transcript, namedClipboardTarget("transcript"));
    toastManager.update(toastId, {
      type: "success",
      title: m(msg("Transcript copied")),
      description: projection.thread.title,
      timeout: TRANSCRIPT_RESULT_TOAST_MS,
    });
  } catch (error) {
    toastManager.update(
      toastId,
      stackedThreadToast({
        type: "error",
        title: m(msg("Failed to copy transcript")),
        description: error instanceof Error ? error.message : m(msg("An error occurred.")),
        timeout: TRANSCRIPT_RESULT_TOAST_MS,
      }),
    );
  }
}

const TRANSCRIPT_RESULT_TOAST_MS = 5_000;
