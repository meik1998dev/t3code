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
| `apps/web/src/components/ChatView.tsx`                            | Fork, Compaction fork, Pasted text, Tasks, Linear                        |
| `apps/web/src/components/chat/MessagesTimeline.tsx`               | Fork, Compaction fork, Thinking row                                      |
| `apps/web/src/components/Sidebar.tsx`                             | Sidebar status, Sidebar filter, Sidebar style, Transcript, Agent threads |
| `apps/web/src/index.css`                                          | Sidebar style, Radius, Sidebar status, Mermaid                           |
| `apps/server/src/ws.ts`                                           | GitHub account, Fork, Linear, Thinking row, Agent threads                |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`                | Checkpoint restore, Task tracking, Thinking row, Agent threads           |
| `apps/server/src/provider/RuntimeInstructions.ts`                 | Task tracking, Agent threads                                             |
| `apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts` | Sidebar status, Compaction fork, Agent threads                           |
| `apps/server/src/persistence/Migrations.ts`                       | [Migrations](#migrations)                                                |
| `packages/contracts/src/orchestration.ts`                         | Fork, Sidebar status, Thinking row, Agent threads                        |

## Remote server (VPS) deploy

The fork's server side (GitHub account per repo, Linear picker, agent thread tools,
migrations 50–52) only runs on a machine that has the **fork build**. Every path that
installs a server for you pulls **upstream** `t3` from npm instead: `npx t3 …`,
`t3 service install|update`, and the desktop "SSH environment" mode. Upstream looks the
same in the app, so the gap shows up late as "No skills found", no per-repo PR list, or a
missing sidebar status.

Learned on 2026-09-12 while setting up a root-login VPS (Ubuntu 24.04, Node 22).

### Build and ship (Mac → server)

`~/spindle/deploy.sh` on the Mac does all of this in one command (about 5 minutes).
Move it into `scripts/` when it stabilises.

1. `vp run --filter t3 build` — builds the web UI and bundles it into `apps/server/dist`.
2. `cd apps/server && npm pack` — `pnpm pack` fails without a full `pnpm install`
   (workspace devDependencies). `npm pack` works but copies `"catalog:"` specifiers as is,
   and npm on the server rejects them (`Unsupported URL Type "catalog:"`). Rewrite each one
   with the version from `pnpm-workspace.yaml` (`[catalog]`) and drop `devDependencies`.
3. On the server: `cd ~/.t3/runtime/versions/<version> && npm install <tgz>`. The runtime
   slot is what `~/.t3/runtime/service-launcher.mjs` starts:
   `versions/<version>/node_modules/t3/dist/bin.mjs`, gated by `.install-complete`
   containing `<version>`. `<version>` must equal `apps/server/package.json` and the desktop
   app build (0.0.39 today), because the desktop matches remote runtimes by that number.
4. `~/.t3/runtime/service-state.json` → `{"protocol": 2, "activeVersion": "<version>"}`,
   then `systemctl --user restart t3code`. Keep the runtime's `node_modules` — `node-pty`
   is compiled there, and the fork has the same 13 runtime dependencies as upstream.

### Which side needs a rebuild

- Server-side change (`apps/server`, migrations, server bits of `packages/*`): run the deploy
  script. The installed desktop app keeps working against the new server.
- Client-side change (`apps/web`, `apps/desktop`, `packages/client-runtime`, client bits of
  `packages/contracts`): build and install a new desktop app, `vp run dist:desktop:dmg`. The
  server needs no deploy for that, unless contracts changed what the server sends (then both).
- Mobile (`apps/mobile`): a new mobile build, see `docs/user/install.md`.

### Rules on the server

- Never run `npx t3 service update` there. Never connect with the desktop "SSH environment"
  mode. Both replace the slot with upstream. Use T3 Connect (`t3 connect` on the server).
- The service runs as **root**. Claude Code refuses Full access (`--dangerously-skip-permissions`)
  as root and exits, which surfaces as `turn/setPermissionMode failed` +
  `Claude runtime stream failed`. Fix: `IS_SANDBOX=1` in a systemd drop-in
  (`~/.config/systemd/user/t3code.service.d/env.conf`), plus `EnvironmentFile=` for
  `CLAUDE_CODE_OAUTH_TOKEN`. A normal user account is the cleaner long-term fix.
- The Claude instance field `CLAUDE_CONFIG_DIR` (`homePath`) must be a **directory**. Set to a
  file (the token env file) it silently drops user skills, settings and commands; the global
  skill list can still look fine because the server's cwd is `$HOME`, so
  `$HOME/.claude/skills` is discovered a second time as a "project" root
  (`apps/server/src/provider/Drivers/ClaudeSkills.ts`). Possible fork fix: validate the field
  and show a warning in the provider card.
- Database: a database first created by upstream npm (migrations ≤ 49 today) then booted by
  the fork runs 50–52 cleanly. Never let upstream run again on that database afterwards —
  see [Migrations](#migrations) for the number clash.
- Check after each deploy: `~/.t3/userdata/logs/boot-service.log` prints "Spindle", the
  `$` picker lists user skills inside a worktree thread, and a repo with `gh.account` set
  shows its pull requests.

### Open in editor from a remote environment

The server advertises SSH host names for the Open menu: `<hostname>.local` via mDNS, or the
tailnet name. A VPS reached through T3 Connect advertises its `<hostname>.local`, which the
Mac cannot resolve. Map it once in `~/.ssh/config` on the Mac; VS Code and Zed both use it:

```
Host <hostname>.local
  HostName <server-ip>
  User <login-user>
```

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

## Editors

### Open remote folders in Zed (#42)

- What: on a remote environment, the Open menu lists Zed when it is installed on the viewing
  machine. The desktop app runs `zed ssh://<host><path>` locally (Zed has no URL scheme for
  SSH). Browsers keep VS Code only.
- Key files: `packages/contracts/src/{editor,ipc}.ts` (`remoteSshCli`, `buildRemoteEditorCommand`,
  bridge method), `apps/desktop/src/ipc/methods/window.ts` (`openRemoteEditorCommand`),
  `apps/desktop/src/{preload,ipc/channels,ipc/DesktopIpcHandlers}.ts`,
  `apps/web/src/remoteOpen.ts` (`openRemoteEditor`), `apps/web/src/components/chat/OpenInPicker.tsx`.
- Tests: `packages/contracts/src/editor.test.ts`, `apps/web/src/remoteOpen.test.ts`,
  `apps/desktop/src/ipc/methods/window.test.ts`.
- Check: desktop, remote environment, Zed CLI on PATH → Open ▾ shows Zed and opens the folder over
  SSH. The host is the advertised name (`<hostname>.local` or tailnet) or the SSH alias, so it must
  resolve in `~/.ssh/config`.
- Drop when: upstream gives Zed (or a generic CLI editor) a remote launch path.

## Look and feel

### Corner radius (#9; #36 reverted by #39)

- What: a smaller border radius across the app. The composer radius was restored once after a sync,
  and again when the upstream composer footer came back (`rounded-3xl` in `ComposerSurface.tsx`).
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

### App name without "(Alpha)" (#43)

- What: the stable desktop build is named `Spindle`, not `Spindle (Alpha)`. Dev and Nightly keep
  their suffix so builds stay easy to tell apart. The `Alpha` stage label still exists in contracts;
  only the display name drops it.
- Key files: `apps/desktop/package.json` (`productName`), `apps/desktop/src/app/DesktopEnvironment.ts`,
  `apps/desktop/scripts/electron-launcher.mjs`, `apps/web/src/branding.logic.ts`, `apps/web/index.html`.
- Tests: `apps/web/src/branding.test.ts`, `apps/desktop/src/app/{DesktopEnvironment,DesktopAppIdentity}.test.ts`,
  `scripts/build-desktop-artifact.test.ts` (the identity test also fixes the legacy user-data path,
  which is `T3 Code (Alpha)` on real installs).
- Check: the menu bar, window title, and About panel say `Spindle`; a `-nightly` version says `Spindle (Nightly)`.
- Warning: the app bundle is now `Spindle.app`. Remove the old `Spindle (Alpha).app` by hand after
  the first install. User data is not affected (it lives under `~/.t3`).

### Hide "Add action" until a project has actions (direct commit)

- Key files: `apps/web/src/components/chat/ChatHeader.tsx`.
- Check: a project with no actions shows no "Add action" in the chat header.
