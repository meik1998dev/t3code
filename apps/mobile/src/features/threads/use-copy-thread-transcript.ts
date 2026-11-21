import type { MenuAction } from "@react-native-menu/menu";
import { msg } from "gt-react-native";
import { buildThreadTranscript } from "@t3tools/client-runtime/thread-transcript";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useCallback } from "react";
import { Alert } from "react-native";

import { m } from "../../i18n/messages";
import { tryCopyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { loadFullThreadHistory } from "../../state/threads";

export const COPY_TRANSCRIPT_MENU_ACTION: MenuAction = {
  id: "copy-transcript",
  title: m(msg("Copy transcript")),
  image: "doc.on.doc",
};

/**
 * Copies the whole thread as markdown from a list row menu. The list only knows
 * the thread shell, so the full history is fetched on demand; a long thread is
 * one request and the haptic confirms when the text lands on the clipboard.
 */
export function useCopyThreadTranscript(thread: {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
}) {
  const { environmentId, id: threadId } = thread;
  return useCallback(async () => {
    try {
      const projection = await loadFullThreadHistory({ environmentId, threadId });
      const copied = await tryCopyTextWithHaptic(
        buildThreadTranscript(projection.thread.title, projection.messages),
        { target: "transcript" },
      );
      if (!copied) {
        Alert.alert(
          m(msg("Could not copy transcript")),
          m(msg("The clipboard did not accept the text.")),
        );
      }
    } catch (error) {
      Alert.alert(
        m(msg("Could not copy transcript")),
        error instanceof Error ? error.message : m(msg("An error occurred.")),
      );
    }
  }, [environmentId, threadId]);
}
