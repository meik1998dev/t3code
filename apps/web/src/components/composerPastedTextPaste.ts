import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { shouldCompactPastedText } from "~/lib/pastedText";

interface ComposerPastedTextPasteOptions {
  createPastedTextNode: (text: string) => LexicalNode;
}

/**
 * Folds a large plain-text paste into one pasted-text chip. Runs ahead of the
 * mention/citation paste handler and the plain-text fallback so neither sees
 * the raw text; small pastes fall through untouched.
 */
export function registerComposerPastedTextPaste(
  editor: LexicalEditor,
  options: ComposerPastedTextPasteOptions,
): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent) || event.clipboardData === null) {
        return false;
      }
      if (event.clipboardData.files.length > 0) {
        return false;
      }
      const text = event.clipboardData.getData("text/plain");
      if (!shouldCompactPastedText(text)) {
        return false;
      }
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return false;
      }
      event.preventDefault();
      selection.insertNodes([options.createPastedTextNode(text)]);
      return true;
    },
    COMMAND_PRIORITY_CRITICAL,
  );
}
