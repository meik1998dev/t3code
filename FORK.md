# Fork ledger

This fork (`meik1998dev/t3code`) carries changes on top of upstream `pingdotgg/t3code`.
Read this before every upstream sync. Update it in the same PR as any fork change.

- Upstream remote: `pingdotgg`. Fork remote: `origin`.
- Last synced upstream commit: `9a49d6d5a6` (2026-09-16, `ci(desktop): sign fork PR macOS previews without exposing signing secrets (#11760)`).
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
This already happened twice: fork 48 hid upstream 48, and fork 50–52 hid upstream 50–51.
The repair migrations below make both upgrade paths safe.

Fork migrations today:

| Number | File                                         | From           |
| ------ | -------------------------------------------- | -------------- |
| 53     | `053_RepairThreadBranchPullRequestColumn.ts` | Sync repair    |
| 55     | `055_RepairUpstreamMigrationsAfterFork.ts`   | Sync repair    |

Upstream owns 50 (`ProjectionThreadPullRequests`) and 51 (`ProjectionThreadMessageContext`).
Migration 55 idempotently reapplies upstream 50–51 and fork 53 for databases that had already
recorded the fork's old 50–54 sequence. The removed parent-thread migration remains only as a
historical row in upgraded databases; the removed task-plan lookup may likewise remain as an
unused index in upgraded databases. New databases create neither fork feature.

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

| File                                                              | Entries                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/web/src/components/ChatView.tsx`                            | Tasks                                                                    |
| `apps/web/src/components/Sidebar.tsx`                             | Sidebar filter, Sidebar style, Transcript                                |
| `apps/web/src/index.css`                                          | Sidebar style, Radius, Mermaid                                           |
| `apps/server/src/ws.ts`                                           | GitHub account, Agent ports                                              |
| `apps/server/src/provider/Layers/ClaudeAdapter.ts`                | Task tracking                                                            |
| `apps/server/src/provider/RuntimeInstructions.ts`                 | Task tracking                                                            |
| `apps/server/src/persistence/Migrations.ts`                       | [Migrations](#migrations)                                                |

## Remote server (VPS) deploy

The fork's server side (GitHub account per repo, agent ports, and repair migrations 53 and 55)
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

### Claude summarized thinking (direct commit)

- What: compatible Claude models receive `--thinking-display summarized`, so the live Thinking
  preview has text. An explicit launch argument still wins, and older CLI/model combinations do
  not receive the hidden flag.
- Key files: `apps/server/src/provider/{ClaudeModelCatalog,ClaudeModelCatalog.testFixtures}.ts`,
  `apps/server/src/provider/Layers/ClaudeAdapter.ts`.
- Tests: `ClaudeModelCatalog.test.ts`, `ClaudeAdapter.test.ts`.
- Check: start a thinking-capable Claude model and confirm its live Thinking row contains a summary.
- Drop when: upstream requests summarized thinking or the Claude SDK exposes a stable equivalent.

## Transcripts

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
  action. No working circle in statuses.
- Key files: `apps/web/src/index.css`, `Sidebar.tsx`, `sidebar/SidebarUpdatePill.tsx`.
- Check: compare row height and text size with the pre-sync build.

## Git and GitHub

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

### Download page installs from a checkout (sync/v0.0.42)

- What: the marketing download page's Terminal section tells people to run the fork from a git
  checkout (`vp i && vp run dev`). Upstream shows `npx t3@nightly` plus the `t3.codes` install
  scripts, which install upstream T3 Code, not this fork.
- Key files: `apps/marketing/src/pages/download.astro`.
- Check: open the download page. The Terminal section shows the checkout command, not `npx t3`.
- Warning: this conflicts on every sync while upstream keeps improving its installers. Keep the
  fork side unless the fork starts publishing its own package or install script.
- Drop it when: Spindle ships a real installer or npm package of its own.
