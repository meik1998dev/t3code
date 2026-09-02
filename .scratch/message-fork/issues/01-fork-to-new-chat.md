# 01 — Fork to new chat

**What to build:** Every message in the web timeline (user and assistant) gets a "..." action menu next to the existing Copy and Revert icons. It holds one item, "Fork to new chat". Clicking it opens a new draft thread in the same project, on the same branch and worktree as the source thread, with the same provider and model. The composer of the new thread is pre-filled, not sent, with a plain-text transcript of the source thread up to and including the clicked message (the fork point). The transcript starts with a line "Forked from <source title>" and then "**User:**" / "**Assistant:**" blocks with message text only. Tool calls, attachments, and reasoning are dropped silently. No size cutoff. The source thread is not changed. The menu items are disabled while a turn is running, like Revert today. The thread title is derived by the server from the first message, as for any thread.

**Blocked by:** None — can start immediately.

**Status:** implemented

- [x] "..." menu appears on hover for user and assistant messages on web and desktop
- [x] "Fork to new chat" opens a new draft thread on the same branch/worktree, same provider and model, and navigates to it
- [x] Composer holds the transcript, nothing is sent automatically
- [x] Transcript helper lives in client-runtime, is pure, and has a unit test covering order, fork point inclusion, and dropped tool content
- [x] Menu items are disabled while a turn is running
- [x] Glossary terms "Fork" and "Fork point" are used in code names and docs
- [x] Short "Fork a chat" section in the user docs
