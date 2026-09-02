# 03 — Revert on assistant messages

**What to build:** Assistant messages on web get the same Revert icon that user messages have. Reverting to an assistant message returns the workspace to the state right after that reply: files match that turn's checkpoint, the chat keeps that reply, and all later turns are removed. This maps the assistant message to its turn's checkpoint turn count and reuses the existing revert command; no contract change. The icon is disabled while a turn is running or a revert is in progress, and disabled with a tooltip when the turn has no checkpoint.

**Blocked by:** None — can start immediately. Prefer to land after 01 to avoid conflicts in the timeline files.

**Status:** implemented

- [x] Revert icon on assistant messages, same look as on user messages
- [x] Revert restores files to the checkpoint after that turn and removes later turns
- [x] Logic test: assistant message maps to the correct turn count, including the last turn and a turn without checkpoint
- [x] Disabled states match the user-message button
- [x] User docs mention revert from an assistant reply
