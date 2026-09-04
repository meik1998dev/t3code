import { buildThreadTranscript } from "@t3tools/client-runtime/thread-transcript";
import type { ScopedThreadRef } from "@t3tools/contracts";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
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
    title: "Copying transcript…",
    description: title,
    timeout: 0,
  });
  try {
    const thread = await loadFullThreadHistory(threadRef);
    const transcript = buildThreadTranscript(thread.title, thread.messages);
    await writeTextToClipboard(transcript, "transcript");
    toastManager.update(toastId, {
      type: "success",
      title: "Transcript copied",
      description: thread.title,
      timeout: TRANSCRIPT_RESULT_TOAST_MS,
    });
  } catch (error) {
    toastManager.update(
      toastId,
      stackedThreadToast({
        type: "error",
        title: "Failed to copy transcript",
        description: error instanceof Error ? error.message : "An error occurred.",
        timeout: TRANSCRIPT_RESULT_TOAST_MS,
      }),
    );
  }
}

const TRANSCRIPT_RESULT_TOAST_MS = 5_000;
