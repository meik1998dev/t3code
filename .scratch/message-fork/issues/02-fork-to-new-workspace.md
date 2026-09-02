# 02 — Fork to new workspace

**What to build:** The message action menu gets a second item, "Fork to new workspace". It behaves like "Fork to new chat" but the new draft thread is in worktree mode and remembers the fork point's checkpoint ref. When the user sends the first message, the server creates a new worktree whose files match that checkpoint, on a new temporary branch, with the source thread's branch shown as the base branch. Fork point rule: a user message means the checkpoint before its turn, an assistant message means the checkpoint after its turn. If the clicked message has no checkpoint (failed turn, checkpoint still saving, older thread), the item is shown disabled with the tooltip "No checkpoint for this message". This needs one optional field on the worktree bootstrap contract, a start ref, that the server uses as the git base when present. The base branch label stays a real branch name.

**Blocked by:** 01 — Fork to new chat.

**Status:** implemented

- [x] Worktree bootstrap accepts an optional start ref; server uses it as the base commit and keeps the base branch label
- [x] Focused server test: worktree created from a checkpoint ref has that ref's files
- [x] "Fork to new workspace" opens a draft in worktree mode carrying the start ref, transcript pre-filled
- [x] First send creates the worktree from the checkpoint; the new thread shows its worktree path
- [x] Item disabled with tooltip when no checkpoint exists for the fork point
- [x] User docs section updated with the workspace variant
