# Fork ledger

This fork (`meik1998dev/t3code`) carries changes on top of upstream `pingdotgg/t3code`.
Read this before every upstream sync. Update it in the same PR as any fork change.

- Upstream remote: `pingdotgg`. Fork remote: `origin`.
- Last synced upstream commit: `1d1bf5040` (2026-09-07, `chore(mobile): bump app version to 1.1.0`).
- Fork commits since that sync: `git log --first-parent pingdotgg/main..origin/main`.

Each entry says what the change does, which files carry it, how to check it after a sync,
and when to drop it because upstream does the same thing.

## Sync steps

1. `git fetch pingdotgg` and branch `sync/<upstream-version>` from `origin/main`.
2. Read [Migrations](#migrations) first. Then read [Hot files](#hot-files).
3. `git merge pingdotgg/main`. `rerere` is on, so a conflict fixed once is reused next time.
4. For each conflict, find the entry below. Keep, merge, or drop the fork side.
5. Run the tests named in the touched entries: `vp test run <files>`.
6. Run each touched entry's "Check" in the app.
7. Update "Last synced upstream commit" above and any changed entries. Open the PR.
8. After merge: `git tag sync/<upstream-version> && git push origin sync/<upstream-version>`.

One-time setup per clone: `git config rerere.enabled true && git config rerere.autoupdate true`.

## Migrations

The migration runner tracks migrations by number only. If the fork and upstream both use a
number, a database that already ran the fork migration skips the upstream one without an error.
This already happened once: fork 48 hid upstream 48, and `051_RepairThreadBranchPullRequestColumn`
repairs it.

Fork migrations today:

| Number | File                                         | From               |
| ------ | -------------------------------------------- | ------------------ |
| 50     | `050_ThreadTaskPlanLookup.ts`                | Sidebar status     |
| 51     | `051_RepairThreadBranchPullRequestColumn.ts` | Sync repair        |
| 52     | `052_ProjectionThreadsParentThreadId.ts`     | Agent thread tools |

**Open clash:** upstream `main` now has `050_ProjectionThreadPullRequests.ts`. On the next
sync, databases that already ran the fork's 50 will skip it.

On every sync where numbers clash:

1. Take upstream's files and numbers as they are.
2. Move fork migrations to numbers after upstream's last one. Keep them idempotent
   (`IF NOT EXISTS`, or a `PRAGMA table_info` check).
3. For each upstream migration a fork database skipped, add an idempotent repair migration
   after it, like `051`. Upstream data migrations (not only `ADD COLUMN`) need a repair that
   runs the same logic safely twice.
4. Test on a `VACUUM INTO` copy of `~/.t3/userdata/state.sqlite`, never on the live file.

## Hot files

Many fork entries touch these files. Expect conflicts here on each sync.

| File                                                              | Entries                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web/src/components/ChatView.tsx`                            | Fork, Compaction fork, Pasted text, Tasks, Composer footer, Linear       |
| `apps/web/src/components/chat/MessagesTimeline.tsx`               | Fork, Compaction fork, Thinking row                                      |
| `apps/web/src/components/Sidebar.tsx`                             | Sidebar status, Sidebar filter, Sidebar style, Transcript, Agent threads |
| `apps/web/src/components/chat/ChatComposer.tsx`                   | Composer footer, Settings pill                                           |
| `apps/web/src/components/BranchToolbar*.tsx`                      | Composer footer, Branch font, Settings pill                              |
| `apps/web/src/index.css`                                          | Sidebar style, Radius, Sidebar status, Mermaid                           |
| `apps/server/src/ws.ts`                                           | GitHub account, Fork, Linear, Thinking row, Agent threads                |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`                | Checkpoint restore, Task tracking, Thinking row, Agent threads           |
| `apps/server/src/provider/RuntimeInstructions.ts`                 | Task tracking, Agent threads                                             |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | Sidebar status, Compaction fork, Agent threads                           |
| `apps/server/src/persistence/Migrations.ts`                       | [Migrations](#migrations)                                                |
| `packages/contracts/src/orchestration.ts`                         | Fork, Sidebar status, Thinking row, Agent threads                        |

## Agent rules

### Fork ledger rule in AGENTS.md

- What: a "Fork ledger" section at the end of `AGENTS.md` tells agents to follow and maintain
  this file. `CLAUDE.md` imports `AGENTS.md`, so Claude and Codex both read it.
- Key files: `AGENTS.md`.
- Check: after a sync, the section is still the last one in `AGENTS.md`.
- On conflict: take upstream's `AGENTS.md`, then add the section back at the end.

## Agents and providers

### Agent thread tools (#37)

- What: agents can start, route, review, and message other threads through the `t3-code` MCP
  toolkit. Threads keep a `parentThreadId`. Sidebar and mobile show an "agent started" icon.
  A setting holds model routing notes.
- Key files: `apps/server/src/mcp/toolkits/orchestration/{handlers,tools}.ts`,
  `apps/server/src/orchestration/ThreadBootstrap.ts`, `orchestration/decider.ts`,
  `orchestration/commandInvariants.ts`, migration 52, `provider/RuntimeInstructions.ts`,
  every provider adapter (`Layers/*Adapter.ts`, `CodexSessionRuntime.ts`),
  `packages/contracts/src/{orchestration,settings}.ts`, `apps/web/src/components/settings/SettingsPanels.tsx`,
  `apps/mobile/src/features/threads/agent-started-icon.tsx`, `docs/user/thread-sidebar.md`.
- Tests: `apps/server/src/mcp/toolkits/orchestration/handlers.test.ts`,
  `apps/server/src/orchestration/decider.parentThread.test.ts`.
- Check: from a Claude thread, ask it to start a new thread with `start_thread`. The new thread
  appears in the sidebar with the agent icon.
- Drop when: upstream ships its own thread-spawning MCP tools.

### Task tracking rule (#28, #29, direct commits)

- What: runtime instructions ask Claude and Codex to keep a task list for work with 3+ steps.
  Claude task tools stay on for new models. The Codex `update_plan` tool is on again.
- Key files: `apps/server/src/provider/RuntimeInstructions.ts`,
  `apps/server/src/provider/CodexDeveloperInstructions.ts`,
  `apps/server/src/provider/Drivers/ClaudeHome.ts`, `apps/server/src/provider/Layers/codexLaunchArgs.ts`.
- Tests: `RuntimeInstructions.test.ts`, `CodexDeveloperInstructions.test.ts`, `ClaudeHome.test.ts`,
  `codexLaunchArgs.test.ts`.
- Check: ask Claude and Codex for a 3-file change. Both show a task list in the composer.
- Drop when: upstream turns these tools on and adds its own instruction.

### Live Thinking row (#38; #30 was reverted by #31)

- What: the server streams a thinking preview into the Thinking row. Claude gets
  `--thinking-display summarized`, because Opus 4.8+ sends empty thinking by default.
  The flag is only sent when the model's catalog `minVersion` is 2.1.128 or newer.
- Key files: `apps/server/src/orchestration/ThreadThinkingPreview.ts`,
  `orchestration/Layers/ProviderRuntimeIngestion.ts`, `orchestration/runtimeLayer.ts`,
  `provider/ClaudeModelCatalog.ts`, `provider/Layers/ClaudeAdapter.ts`, `ws.ts`,
  `packages/contracts/src/{orchestration,server}.ts`, `packages/client-runtime/src/state/{threads,threadState}.ts`,
  `apps/web/src/components/chat/MessagesTimeline.tsx`.
- Tests: `ThreadThinkingPreview.test.ts`, `ClaudeModelCatalog.test.ts`, `ClaudeAdapter.test.ts`.
- Check: send a hard prompt on Opus 5. Thinking text streams in the Thinking row.
- Drop when: upstream shows live thinking text.

### Checkpoint restore without a live session (#7)

- What: restoring a checkpoint works when the provider session is not running.
- Key files: `apps/server/src/orchestration/Layers/CheckpointReactor.ts`,
  `provider/Layers/{ClaudeAdapter,ProviderService}.ts`, `provider/Services/ProviderAdapter.ts`,
  `packages/client-runtime/src/state/threadReducer.ts`.
- Tests: `CheckpointReactor.test.ts`, `threadReducer.test.ts`.
- Check: restart the server, open an old thread, restore an earlier checkpoint.
- Drop when: upstream restores without a session.

## Fork and transcripts

### Fork from a message (#3)

- What: a message menu item forks the chat from that message's checkpoint into a new thread.
- Key files: `packages/client-runtime/src/forkTranscript.ts`, `apps/web/src/components/ChatView.tsx`,
  `chat/MessagesTimeline.tsx`, `apps/web/src/state/threads.ts`, `composerDraftStore.ts`,
  `hooks/useHandleNewThread.ts`, `apps/server/src/checkpointing/Utils.ts`, `packages/shared/src/git.ts`,
  `docs/user/composer.md`, `docs/internals/glossary.md`.
- Tests: `forkTranscript.test.ts`, `ChatView.logic.test.ts`, `composerDraftStore.test.ts`.
- Check: open a thread with 3+ turns, fork from the second message. The new thread has the
  history up to that point.
- Drop when: upstream ships message forking.

### Fork from the last compaction (#32, #34, #35)

- What: fork a chat from its last context compaction. The fork keeps the turn that reported
  the compaction, and loads full history in long threads.
- Key files: `packages/client-runtime/src/forkTranscript.ts`, `apps/web/src/components/ChatView.tsx`,
  `chat/MessagesTimeline.tsx`, `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`.
- Tests: `forkTranscript.test.ts`, `ProjectionSnapshotQuery.test.ts`.
- Check: in a long thread with a compaction, fork from it. The new thread starts at the summary.
- Drop when: upstream ships the same fork, or the message fork above is dropped.

### Copy full transcript (#24)

- What: thread menu on web and mobile copies the full thread transcript.
- Key files: `packages/client-runtime/src/{threadTranscript,state/fullThreadHistory}.ts`,
  `apps/web/src/components/threadTranscriptCopy.ts`, `threadActionMenu.logic.ts`, `Sidebar.tsx`,
  `apps/mobile/src/features/threads/use-copy-thread-transcript.ts`.
- Tests: `threadTranscript.test.ts`, `threadActionMenu.logic.test.ts`.
- Check: right-click a thread and copy the transcript. Paste shows all turns.
- Drop when: upstream adds a copy transcript action.

## Composer

### Branch controls in the composer footer (#4, #5, #16, #25, direct commit)

- What: the branch bar is removed. Workspace, env mode, and branch controls sit in the composer
  footer and stay readable in a narrow panel. The old measurement-based footer layout is deleted.
- Key files: `apps/web/src/components/BranchToolbar.tsx`, `BranchToolbar.logic.ts`,
  `BranchToolbar{BranchSelector,EnvModeSelector,EnvironmentSelector}.tsx`, `chat/ChatComposer.tsx`,
  `chat/ComposerSurface.tsx`, `ChatView.tsx`, `packages/contracts/src/settings.ts`.
- Deleted file (do not bring back on merge): `chat/restingComposerControlsMeasurement.ts`.
  `composerFooterLayout.ts` was deleted too, but upstream reworked it and the 09-07 sync kept
  upstream's version. `ChatView.tsx` and `ChatComposer.tsx` use it now.
- Tests: `BranchToolbar.logic.test.ts`, `packages/contracts/src/settings.test.ts`.
- Check: open a new thread, then narrow the panel. No branch bar above the composer, and the
  footer controls do not overlap.
- Drop when: upstream redesigns the footer the same way. If upstream changes the branch bar a lot,
  take upstream's version and redo this change.

### One settings pill (#13, #14)

- What: model traits and access mode are merged into one composer pill. The lock icon is gone,
  and workspace and branch controls are smaller.
- Key files: `apps/web/src/components/chat/ComposerSettingsMenu.tsx`, `chat/ChatComposer.tsx`,
  `chat/TraitsPicker.tsx`, `chat/ProviderModelPicker.tsx`, `chat/composerProviderState.tsx`,
  `chat/providerIconUtils.ts`, `docs/user/{install,permission-modes}.md`.
- Deleted file: `chat/CompactComposerControlsMenu.tsx`.
- Check: click the pill. It shows traits and access mode in one menu.
- Drop when: upstream merges these controls.

### Hide local checkout control after the first turn (#11)

- Key files: `apps/web/src/components/BranchToolbar.logic.ts`, `BranchToolbar.tsx`.
- Tests: `BranchToolbar.logic.test.ts`.
- Check: after the first turn, the env mode control is gone.

### Pasted text chips (#19, #26)

- What: large pasted text becomes a chip. Clicking the chip shows the full text in a popover.
- Key files: `apps/web/src/lib/pastedText.ts`, `components/composerPastedTextPaste.ts`,
  `ComposerPromptEditor.tsx`, `composer-editor-mentions.ts`, `composer-logic.ts`, `pendingUserInput.ts`.
- Tests: `pastedText.test.ts`, `ComposerPromptEditor.test.ts`, `composer-editor-mentions.test.ts`,
  `composer-logic.test.ts`, `pendingUserInput.test.ts`.
- Check: paste 50+ lines. A chip appears. Send it, and the agent gets the full text.
- Drop when: upstream compacts pasted text.

### Composer triggers anywhere (#12)

- What: `/` and `@` open their menus in the middle of text, not only at the start.
- Key files: `packages/shared/src/composerTrigger.ts`, `apps/web/src/composer-logic.ts`.
- Tests: `composerTrigger.test.ts`, `composer-logic.test.ts`.
- Check: type `please use /` in the middle of a sentence. The skills menu opens.

### Task list badge stays (#27)

- What: the composer task badge stays after the turn ends.
- Key files: `apps/web/src/components/ChatView.logic.ts`, `ChatView.tsx`, `chat/ComposerTasksBadge.tsx`.
- Tests: `ChatView.logic.test.ts`.
- Check: after a turn with a task list ends, the badge is still there.

## Sidebar

### Current status icons and task progress (direct commits)

- What: new status icons on web and mobile, with task progress in the sidebar. Idle threads have
  no icon. Thread rows have no provider icon. The Working wave does not mix into the Monitoring eye.
- Key files: `packages/client-runtime/src/currentStatus.ts`, `packages/shared/src/taskProgress.ts`,
  `apps/web/src/components/sidebar/{CurrentStatusIcon,SidebarTasks}.tsx`, `Sidebar.tsx`,
  `LegacySidebar.tsx`, `ThreadStatusIndicators.tsx`, `index.css`,
  `apps/mobile/src/components/CurrentStatusIcon.tsx`, `apps/mobile/src/features/threads/{SidebarTasks,thread-list-v2-items}.tsx`, `threadListV2.ts`,
  `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts`, migration 50,
  `packages/contracts/src/orchestration.ts`, `docs/user/thread-sidebar.md`.
- Tests: `taskProgress.test.ts`, `threadListV2.test.ts`, `ProjectionSnapshotQuery.test.ts`.
- Check: start a turn with a task list. The sidebar row shows the working icon and progress.
  An idle thread shows no icon.
- Drop when: upstream ships the same status set.

### Multi-project filter (#20, #33)

- What: filter the sidebar and the pull request list by several projects at once.
- Key files: `apps/web/src/components/Sidebar.logic.ts`, `Sidebar.tsx`,
  `components/pullRequest/{PullRequestListFilters.tsx,pullRequestList.logic.ts,pullRequestListPreferences.ts}`,
  `apps/web/src/routes/_chat.pull-requests.tsx`.
- Tests: `Sidebar.logic.test.ts`, `PullRequestListFilters.test.tsx`, `pullRequestList.logic.test.ts`.
- Check: pick two projects in each filter. Only those threads and pull requests show.

### Sidebar look (#6, #8, #22, #23)

- What: bigger sidebar text and taller rows. The update pill shows only when an update needs
  action. No working circle in statuses.
- Key files: `apps/web/src/index.css`, `Sidebar.tsx`, `sidebar/SidebarUpdatePill.tsx`.
- Check: compare row height and text size with the pre-sync build.

## Git, GitHub, and Linear

### GitHub account per repo (#1)

- What: `git config gh.account <user>` picks the `gh` account for that repo's pull request calls.
- Key files: `apps/server/src/sourceControl/{GitHubAccount,GitHubCli}.ts`,
  `apps/server/src/pullRequest/*`, `packages/contracts/src/pullRequest.ts`, `docs/user/source-control.md`.
- Tests: `GitHubAccount.test.ts`, `GitHubCli.test.ts`, `PullRequestService.test.ts`.
- Check: in a repo with `gh.account` set to a non-default account, the pull request list loads.
- Drop when: upstream supports several `gh` accounts.

### No `t3code/` worktree branch prefix (#2)

- Key files: `packages/shared/src/git.ts`, `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`.
- Tests: `packages/shared/src/git.test.ts`, `ProviderCommandReactor.test.ts`.
- Check: start a new worktree thread. The branch name has no `t3code/` prefix.

### Pull request status with git actions (#18)

- Key files: `apps/web/src/components/GitActionsControl.tsx`, `BranchToolbarBranchSelector.tsx`.
- Check: on a branch with an open pull request, the status shows next to git actions.

### Worktree from a Linear issue (#21)

- What: pick a Linear issue to start a worktree. The API key is set in Settings → Integrations.
- Key files: `apps/server/src/linear/LinearService.ts`, `apps/server/src/{ws,server}.ts`,
  `auth/RpcAuthorization.ts`, `packages/contracts/src/{linear,rpc,index}.ts`,
  `packages/client-runtime/src/state/linear.ts`, `apps/web/src/components/LinearIssuePicker.tsx`,
  `settings/IntegrationsSettings.tsx`, `composerDraftStore.ts`, `docs/user/linear.md`.
- Tests: `LinearService.test.ts`, `packages/contracts/src/linear.test.ts`, `composerDraftStore.test.ts`.
- Check: open the Linear picker in a new thread. Issues load, and picking one names the branch.
- Drop when: upstream ships a Linear integration.

## Look and feel

### Corner radius (#9; #36 reverted by #39)

- What: a smaller border radius across the app. The composer radius was restored once after a sync.
- Key files: `apps/web/src/index.css`, `chat/{ComposerBanner,ComposerSurface,ProposedPlanCard}.tsx`.
- Check: the composer and cards have the smaller radius.
- Warning: upstream often changes radius tokens. Take upstream's token names, then set the fork values again.

### Branch names in the code font (#10)

- Key files: `apps/web/src/components/BranchToolbarBranchSelector.tsx`, `Sidebar.tsx`, `ThreadCommandSubtitle.tsx`.

### Mermaid diagrams (#15)

- What: ` ```mermaid ` blocks render as diagrams in chat.
- Key files: `apps/web/src/components/{MermaidDiagram,ChatMarkdown}.tsx`, `index.css`,
  `apps/web/package.json` (the `mermaid` dependency), `pnpm-lock.yaml`.
- Check: ask the agent for a small mermaid flowchart. It renders as a diagram.
- Warning: on a lockfile conflict, take upstream's `pnpm-lock.yaml`, then run `vp i` again.

### Hide "Add action" until a project has actions (direct commit)

- Key files: `apps/web/src/components/chat/ChatHeader.tsx`.
- Check: a project with no actions shows no "Add action" in the chat header.
