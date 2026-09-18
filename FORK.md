# Fork ledger

This fork (`meik1998dev/t3code`) carries changes on top of upstream `pingdotgg/t3code`.
Read this before every upstream sync. Update it in the same PR as any fork change.

- Upstream remote: `pingdotgg`. Fork remote: `origin`.
- Last synced upstream commit: `9ea9c3d5d2` (2026-09-18, `fix(web): keep a file-to-symlink type change from crashing the diff view (#11075)`, v0.0.43-nightly).
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
This already happened three times: fork 48 hid upstream 48, fork 50–52 hid upstream 50–51, and
fork 53 hid upstream 53.
The repair migrations below make both upgrade paths safe.

Fork migrations today:

| Number | File                                         | From          |
| ------ | -------------------------------------------- | ------------- |
| 55     | `055_RepairUpstreamMigrationsAfterFork.ts`   | Sync repair   |
| 56     | `056_RepairThreadTitleStateColumn.ts`        | Sync repair   |
| 57     | `057_ProjectionThreadsParentThreadId.ts`     | Agent threads |
| 58     | `058_RepairThreadBranchPullRequestColumn.ts` | Sync repair   |
| 59     | `059_RepairPullRequestFilesViewedTable.ts`   | Sync repair   |

Upstream owns 50 (`ProjectionThreadPullRequests`), 51 (`ProjectionThreadMessageContext`),
52 (`ProjectionThreadTitleState`), and 53 (`PullRequestFilesViewed`). Migration 56 idempotently
adds `title_state_json` for databases that had already recorded the fork's own 52. The v0.0.43
sync moved the fork's own 53 to 58, and migration 59 replays upstream's 53 for databases that
had recorded the fork's 53 instead.
Migration 55 idempotently reapplies upstream 50–51 and fork 53 for databases that had already
recorded the fork's old 50–54 sequence. The removed parent-thread migration remains only as a
historical row in upgraded databases; migration 57 idempotently restores that column for both
new and already-upgraded databases. The removed task-plan lookup may remain as an unused index.

On every sync where numbers clash:

1. Take upstream's files and numbers as they are.
2. Move fork migrations to numbers after upstream's last one. Keep them idempotent
   (`IF NOT EXISTS`, or a `PRAGMA table_info` check).
3. For each upstream migration a fork database skipped, add an idempotent repair migration
   after it, like `055`. Upstream data migrations (not only `ADD COLUMN`) need a repair that
   runs the same logic safely twice.
4. Test on a `VACUUM INTO` copy of `~/.t3/userdata/state.sqlite`, never on the live file.

## Hot files

Many fork entries touch these files. Expect conflicts here on each sync.

| File                                               | Entries                                                  |
| -------------------------------------------------- | -------------------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`             | Agent threads, Message fork, Tasks                       |
| `apps/web/src/components/Sidebar.tsx`              | Agent threads, Sidebar filter, Sidebar style, Transcript |
| `apps/web/src/index.css`                           | Sidebar style, Radius, Mermaid                           |
| `apps/server/src/ws.ts`                            | Agent ports, GitHub account, Message fork                |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts` | Agent threads, Task tracking                             |
| `apps/server/src/provider/RuntimeInstructions.ts`  | Agent threads, Task tracking                             |
| `apps/server/src/persistence/Migrations.ts`        | [Migrations](#migrations)                                |
| `apps/server/src/pullRequest/PullRequestService.ts` | GitHub account per repo, Pull request stacks            |
| `packages/contracts/src/orchestration.ts`          | Agent threads, Message fork                              |

## Remote server (VPS) deploy

The fork's server side (GitHub account per repo, agent ports, and repair migrations 55–59)
only runs on a machine that has the **fork build**. Every path that
installs a server for you pulls **upstream** `t3` from npm instead: `npx t3 …`,
`t3 service install|update`, and the desktop "SSH environment" mode. Upstream looks the
same in the app, so the gap shows up late as "No skills found" or no per-repo PR list.

Learned on 2026-09-12 while setting up a root-login VPS (Ubuntu 24.04, Node 22).

### Build and ship (Mac → server)

`~/spindle/deploy.sh` on the Mac does all of this in one command (about 5 minutes).
Move it into `scripts/` when it stabilises.

1. `vp run --filter t3 build` — builds the web UI and bundles it into `apps/server/dist`.
2. `cd apps/server && npm pack` — `pnpm pack` fails without a full `pnpm install`
   (workspace devDependencies). `npm pack` works but copies `"catalog:"` specifiers as is,
   and npm on the server rejects them (`Unsupported URL Type "catalog:"`). Rewrite each one
   with the version from `pnpm-workspace.yaml` (`[catalog]`) and drop `devDependencies`.
3. On the server: `cd ~/.t3/runtime/versions/<version> && npm install <tgz>`, then apply the
   repo's `patches/*.patch` to the installed runtime packages with `patch -p1` (npm ignores pnpm
   patches; without the `@ff-labs/fff-node` one the server dies at boot with
   `ERR_PACKAGE_PATH_NOT_EXPORTED`). `<version>` must equal `apps/server/package.json` and the
   desktop app build (0.0.42 today), because the desktop matches remote runtimes by that number.
4. Point the systemd unit at the slot and restart: `ExecStart=/usr/local/bin/node
~/.t3/runtime/versions/<version>/node_modules/t3/dist/bin.mjs serve`, then
   `systemctl --user daemon-reload && systemctl --user restart t3code`. Since upstream 0.0.42 the
   launcher (`t3 __service-launcher`, protocol 3) only starts a standalone `t3` executable, so the
   old `~/.t3/runtime/service-launcher.mjs` and `service-state.json` are no longer used; the
   server runs unmanaged (no self-update, which the rules below forbid anyway). Keep the runtime's
   `node_modules` — `node-pty` is compiled there.

### Which side needs a rebuild

- Server-side change (`apps/server`, migrations, server bits of `packages/*`): run the deploy
  script. The installed desktop app keeps working against the new server.
- Client-side change (`apps/web`, `apps/desktop`, `packages/client-runtime`, client bits of
  `packages/contracts`): build and install a new desktop app, `vp run dist:desktop:dmg`. The
  server needs no deploy for that, unless contracts changed what the server sends (then both).
- Mobile (`apps/mobile`): a new mobile build, see `docs/user/install.md`.

### Rules on the server

- Never run `npx t3 service update` there; it replaces the slot with upstream.
- The desktop "SSH environment" mode is fine **only while the service is up**: its launch
  script reuses the server named in `~/.t3/userdata/server-runtime.json`. If that file is
  missing (service restarting, or an old copy deleted it on exit) it starts upstream
  `npx t3 serve` on 3774 in the same `~/.t3`, which then hijacks the T3 Connect tunnel too.
  Restart order: quit the desktop app → `systemctl --user restart t3code` → reopen. Check
  `ss -ltnp | grep 377` shows only 3773. See [Shared runtime state](#shared-runtime-state-and-refresh-direct-commit).
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
- Database: migration 55 repairs databases that previously ran the fork's clashing 50–54
  sequence. Test upgrades on a snapshot before each deploy; see [Migrations](#migrations).
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

### Shared runtime state and Refresh (direct commit)

- What: two server fixes for a machine that runs the background service. (1) A server
  removes `server-runtime.json` on shutdown only when the recorded pid is its own, so a
  second server sharing `~/.t3` cannot erase the service's record. (2) A provider Refresh
  drops the cached per-cwd `workspaceSnapshots`; the composer requests them again, so new
  skills, plugins and commands show without a restart.
- Key files: `apps/server/src/serverRuntimeState.ts` (`clearPersistedServerRuntimeState`),
  `apps/server/src/provider/Layers/ProviderRegistry.ts` (`mergeProviderSnapshot`).
- Tests: `apps/server/src/serverRuntimeState.test.ts`,
  `apps/server/src/provider/Layers/ProviderRegistry.test.ts`.
- Check: add a skill dir under `~/.claude/skills`, Settings → Providers → Refresh, open a
  thread in that project, type `$` — the skill is listed. Restart the service while the
  desktop SSH environment is connected: `ss -ltnp | grep 377` still shows only 3773.
- Drop when: upstream guards the runtime-state clear by pid and invalidates workspace
  snapshots on refresh.

### Agent thread tools (#37, restored after v0.0.42 sync)

- What: agents can list projects, models and threads; read another thread; and start or message
  separate threads through the `t3-code` MCP toolkit. Threads retain their `parentThreadId`, and
  web and mobile mark work started by another agent. Only person-started threads receive these
  tools, so agent-created work stays one level deep. A server setting supplies live model-routing
  notes to `list_models`.
- Key files: `apps/server/src/mcp/toolkits/orchestration/{handlers,tools}.ts`,
  `apps/server/src/orchestration/ThreadBootstrap.ts`, orchestration decider/projector and
  projection persistence, migration 57, provider runtime instructions and adapters,
  `packages/contracts/src/{orchestration,settings}.ts`, web settings/sidebar, and mobile thread rows.
- Tests: `apps/server/src/mcp/toolkits/orchestration/handlers.test.ts`,
  `apps/server/src/orchestration/decider.parentThread.test.ts`,
  `apps/server/src/persistence/Migrations/057_ProjectionThreadsParentThreadId.test.ts`,
  provider runtime/MCP tests, and contract settings tests.
- Check: from a person-started Claude or Codex thread, ask it to start a separate thread. The child
  appears with the agent-started indicator and can receive follow-up messages, but cannot create
  another child. Change routing notes in Settings and confirm `list_models` returns the new text.
- Drop when: upstream ships equivalent cross-thread orchestration with parent tracking, routing
  guidance, and the one-level safety boundary.

### Task tracking rule (#28, #29, direct commits)

- What: runtime instructions ask Claude and Codex to keep a task list for work with 3+ steps.
  Claude task tools stay on for new models. The Codex `update_plan` tool is on again.
- Key files: `apps/server/src/provider/RuntimeInstructions.ts`,
  `apps/server/src/provider/CodexDeveloperInstructions.ts`,
  `apps/server/src/provider/Layers/ClaudeAdapter.ts`,
  `apps/server/src/provider/Drivers/ClaudeHome.ts`, `apps/server/src/provider/Layers/codexLaunchArgs.ts`.
- Tests: `RuntimeInstructions.test.ts`, `CodexDeveloperInstructions.test.ts`, `ClaudeHome.test.ts`,
  `codexLaunchArgs.test.ts`.
- Check: ask Claude and Codex for a 3-file change. Both show a task list in the composer.
- Drop when: upstream turns these tools on and adds its own instruction.

## Transcripts

### Fork from a message (#3; restored after v0.0.42 sync)

- What: the message actions menu can fork the conversation through a selected user or terminal
  assistant message. **Fork to new chat** opens a draft in the same checkout. **Fork to new
  workspace** creates its worktree from that message's checkpoint. Both copy the full saved
  user/assistant transcript through the fork point into the new draft and keep the source model.
  The later **Fork after compaction** variants from #32/#34/#35 intentionally remain dropped.
- Key files: `packages/client-runtime/src/forkTranscript.ts`,
  `apps/web/src/components/{ChatView,ChatView.logic}.ts{x,}`,
  `apps/web/src/components/chat/{MessagesTimeline,MessagesTimeline.logic}.ts{x,}`,
  `apps/web/src/{composerDraftStore,state/threads}.ts`,
  `apps/web/src/hooks/useHandleNewThread.ts`, `apps/server/src/checkpointing/Utils.ts`,
  `apps/server/src/{ws,orchestration/ThreadBootstrap}.ts`, `packages/shared/src/git.ts`, and
  `packages/contracts/src/orchestration.ts`.
- Tests: `forkTranscript.test.ts`, `ChatView.logic.test.ts`, `MessagesTimeline.logic.test.ts`,
  `composerDraftStore.test.ts`, `orchestration.test.ts`, and `GitVcsDriverCore.test.ts`.
- Check: fork an earlier user message to a new chat and confirm the draft ends at that message;
  fork a checkpointed message to a new workspace and confirm its first send creates files from
  that checkpoint. Confirm the menu contains no compaction actions.
- Drop when: upstream ships equivalent message-level chat and checkpoint-workspace forking.

### Copy full transcript (#24)

- What: thread menu on web and mobile copies the full thread transcript.
- Key files: `packages/client-runtime/src/{threadTranscript,state/fullThreadHistory}.ts`,
  `apps/web/src/components/threadTranscriptCopy.ts`, `threadActionMenu.logic.ts`, `Sidebar.tsx`,
  `apps/mobile/src/features/threads/use-copy-thread-transcript.ts`.
- Tests: `threadTranscript.test.ts`, `threadActionMenu.logic.test.ts`.
- Check: right-click a thread and copy the transcript. Paste shows all turns.
- Drop when: upstream adds a copy transcript action.

## Composer

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

### Multi-project filter (#20, #33)

- What: filter the sidebar and the pull request list by several projects at once.
- Key files: `apps/web/src/components/Sidebar.logic.ts`, `Sidebar.tsx`,
  `components/pullRequest/{PullRequestListFilters.tsx,pullRequestList.logic.ts,pullRequestListPreferences.ts}`,
  `apps/web/src/routes/_chat.pull-requests.tsx`.
- Tests: `Sidebar.logic.test.ts`, `PullRequestListFilters.test.tsx`, `pullRequestList.logic.test.ts`.
- Check: pick two projects in each filter. Only those threads and pull requests show.
- Warning: the sidebar trigger is upstream's icon-only header button. Do not put a label or
  chevron inside it; they get clipped next to Search. The selection shows as check marks in the
  popup and in the button's tooltip.

### Agent ports popover (#44, #45, #46)

- What: a button at the bottom right of the sidebar (next to the update pill) opens a popover
  with the TCP ports that agent sessions opened, grouped by environment (Mac, VPS). Each row
  shows the port, the command, and the thread or project behind it. Click opens
  `http://localhost:<port>` (in the thread's in-app browser when the port belongs to a thread,
  which also works for a remote environment); a remote port with no thread copies an `ssh -L`
  tunnel command instead. The square button stops the process (`agentPorts.stop`: SIGTERM,
  SIGKILL after 2 s; the server re-scans first so only a current agent port can be hit).
- How ports are found: live, no bookkeeping. Linux: `ss -ltnpH` + `/proc/<pid>/cwd`; macOS:
  `lsof` + `lsof -d cwd`. `ps` gives the process tree. A port is kept when its process is a
  child of the Spindle server (agents and their shells are) or when its folder is inside a
  project root or thread worktree (catches detached servers). The server's own port and system
  services are dropped. Windows returns an empty list with `supported: false`.
- "All" switch in the popover header (#46): the same scan keeps everything else too, as origin
  `system` (a distro postgres, another service, the Spindle server itself), so a user can see
  what already holds a port. The choice is remembered per client in `localStorage`
  (`t3code:agent-ports:show-all`). System rows have no stop button, and `stop` re-scans in the
  agent scope on the server, so they can never be signalled.
- Warning: do not switch Linux back to `lsof`. lsof 4.95 on Ubuntu skips processes whose name
  has parentheses (`next-server (v16.0.3)`), so Next.js never showed up (#45).
- Key files: `packages/contracts/src/agentPorts.ts` (new, `AgentPortsScope`) + `rpc.ts`
  (`agentPorts.list`, `agentPorts.stop`),
  `apps/server/src/ports/AgentPortsService.ts` (new) + `ws.ts`, `server.ts`,
  `auth/RpcAuthorization.ts`, `packages/client-runtime/src/state/agentPorts.ts` (new) +
  `package.json` exports, `apps/web/src/agentPorts.logic.ts` (new),
  `apps/web/src/components/sidebar/SidebarPortsPill.tsx` (new), `sidebar/SidebarChrome.tsx`.
- Tests: `AgentPortsService.test.ts`, `agentPorts.logic.test.ts`.
- Check: start `python3 -m http.server 8765` inside a project folder, open the popover: the port
  shows under that environment with the project name. Stop it: the row goes away within 4 s.
  Turn "All" on: system ports such as `:22` and the server's own port appear, with no stop
  button.
- Warning: both sides change. Ship the server with `deploy.sh` and build a new DMG; an old server
  answers the RPC with "unavailable" in the popover, nothing else breaks.

### Sidebar look (#6, #8, #22, #23)

- What: bigger sidebar text and taller rows. The update pill shows only when an update needs
  action. No working circle in statuses. No provider icon at the end of thread rows (the hover
  tooltip still names the provider and model).
- Key files: `apps/web/src/index.css`, `Sidebar.tsx`, `sidebar/SidebarUpdatePill.tsx`.
- Check: compare row height and text size with the pre-sync build.

## Git and GitHub

### GitHub account per repo (#1)

- What: `git config gh.account <user>` picks the `gh` account for that repo's pull request calls.
- Key files: `apps/server/src/sourceControl/{GitHubAccount,GitHubCli}.ts`,
  `apps/server/src/pullRequest/*`, `packages/contracts/src/pullRequest.ts`, `docs/user/source-control.md`.
- Tests: `GitHubAccount.test.ts`, `GitHubCli.test.ts`, `PullRequestService.test.ts`.
- Sync note: upstream groups viewer lookups by host. The fork groups them by
  (host, kind, account key), so `SupportedProject` carries `viewerAccountKey`, the project scan is
  an `Effect.forEach` that can call `api.getViewerAccountKey`, and the cache is `viewersByAccount`.
  Keep that shape and re-apply upstream's changes on top of it.
- Check: in a repo with `gh.account` set to a non-default account, the pull request list loads.
- Drop when: upstream supports several `gh` accounts.

### No `t3code/` worktree branch prefix (#2)

- Key files: `packages/shared/src/git.ts`, `apps/server/src/orchestration/Layers/ProviderCommandReactor.ts`.
- Tests: `packages/shared/src/git.test.ts`, `ProviderCommandReactor.test.ts`.
- Check: start a new worktree thread. The branch name has no `t3code/` prefix.

### Pull request status with git actions (#18)

- Key files: `apps/web/src/components/GitActionsControl.tsx`, `BranchToolbarBranchSelector.tsx`.
- Check: on a branch with an open pull request, the status shows next to git actions.

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

### Install instructions point at a checkout (sync/v0.0.42)

- What: the fork does not publish an npm package, an installer script, or store listings, so every
  "how to get it" surface tells people to run from a git checkout (`vp i && vp run dev`). Upstream
  shows `curl https://t3.codes/install.sh`, `npx t3@latest`, Homebrew, winget, and AUR, all of which
  install upstream T3 Code instead of this fork.
- Key files: `apps/marketing/src/pages/download.astro`, `README.md`, `docs/user/install.md`,
  `docs/user/background-service.md`, `docs/user/welcome-wizard.md`.
- Check: open the download page. The Terminal section shows the checkout command, not `npx t3`.
- Warning: this conflicts on every sync while upstream keeps improving its installers. Keep the
  fork side unless the fork starts publishing its own package or install script.
- Drop it when: Spindle ships a real installer or npm package of its own.
