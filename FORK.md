# Fork ledger

This fork (`meik1998dev/t3code`) carries changes on top of upstream `pingdotgg/t3code`.
Read this before every upstream sync. Update it in the same PR as any fork change.

- Upstream remote: `pingdotgg`. Fork remote: `origin`.
- Last synced upstream commit: `448b8a9186` (2026-10-21, `fix(server): t3 pair in a worktree no longer falls back to the live install`, v0.1.1).
- Fork commits since that sync: `git log --first-parent pingdotgg/main..origin/main`.

Each entry says what the change does, which files carry it, how to check it after a sync,
and when to drop it because upstream does the same thing.

## Sync steps

1. `git fetch pingdotgg` and branch `sync/<upstream-version>` from `origin/main`.
2. Read [Migrations](#migrations) first. Then read [Hot files](#hot-files).
3. `git merge pingdotgg/main`. `rerere` is on, so a conflict fixed once is reused next time.
4. For each conflict, find the entry below. Keep, merge, or drop the fork side.
5. Run the tests named in the touched entries: `vp test run <files>`.
   Then open a new thread in a dev build. Upstream's web code relies on the React Compiler
   caching: fork code the compiler cannot compile (for example `try/finally`) makes it skip
   the whole component, and upstream hooks then loop ("Too many re-renders", React #301).
6. Run each touched entry's "Check" in the app.
7. Update "Last synced upstream commit" above and any changed entries. Open the PR.
8. After merge: `git tag sync/<upstream-version> && git push origin sync/<upstream-version>`.

One-time setup per clone: `git config rerere.enabled true && git config rerere.autoupdate true`.

## Migrations

The migration runner tracks migrations by number only. If the fork and upstream both use a
number, a database that already ran the fork migration skips the upstream one without an error.
This already happened four times: fork 48 hid upstream 48, fork 50–52 hid upstream 50–51,
fork 53 hid upstream 53, and fork 57–60 hid upstream 57–60. A fourth case needs no clash: upstream added 54 after fork databases had
recorded 59, and the runner only runs IDs above the latest recorded one, so they skipped it.
The repair migrations below make both upgrade paths safe.

Fork migrations today:

| Number | File                                         | From          |
| ------ | -------------------------------------------- | ------------- |
| 68     | `068_RepairUpstreamMigrationsAfterFork.ts`   | Sync repair   |
| 69     | `069_RepairThreadTitleStateColumn.ts`        | Sync repair   |
| 70     | `070_RepairOrchestrationV2AfterFork.ts`      | Sync repair   |
| 71     | `071_ProjectionThreadsParentThreadId.ts`     | Agent threads |
| 72     | `072_RepairThreadBranchPullRequestColumn.ts` | Sync repair   |
| 73     | `073_RepairPullRequestFilesViewedTable.ts`   | Sync repair   |
| 74     | `074_RepairThreadAutoSettleColumn.ts`        | Sync repair   |
| 75     | `075_RepairUpstream57To60AfterFork.ts`       | Sync repair   |

Upstream owns 1–67. Since upstream added a startup check (`assertV2MigrationsCanRun` in
`Migrations.ts`), a recorded name that differs from this build's name at the same id (55 and
up) stops the server. A repair migration cannot fix that, because the check runs before any
migration. So a clash is now fixed by `reconcileForkMigrationLedger.ts`, which runs before the
check: it normalises the fork block onto 68–75 wherever an earlier generation recorded it (61–68
from the v0.0.46 sync, 63–70 from the v0.1.1 sync), and applies the upstream migrations that
generation skipped, safely twice. Nothing runs twice, and the ledger then matches a fresh
database. Fresh databases run upstream 1–67 and the fork's 68–75 do nothing harmful.
Older history: the v0.1.1 sync added upstream 63–67 (drop unused V1 projections, canonicalise
thread PR links, Codex usage index, settled-timestamp repair, webhook dedupe) below the fork's
block, and moved the block from 63–70 to 68–75. The v0.0.46 sync moved the fork's old 57–60 up;
75 runs upstream 57 (only when `scheduled_tasks.webhook_token` is missing) and 58–60, and 70 runs
upstream 55 (only when `orchestration_v2_events` is missing) and 56. Both rename ledger rows to
upstream's names. 74 reruns upstream 54, 73 replays upstream 53, 69 adds `title_state_json` for
databases that recorded the fork's own 52, and 68 reapplies upstream 50–51 for databases that
recorded the fork's old 50–54. 71 keeps `projection_threads.parent_thread_id`; the v1 thread
importer (`orchestration-v2/legacy/LegacyV1ThreadImporter.ts`) maps it to `createdBy: "agent"`
when old threads are copied into the new orchestrator on first start. Databases still on a ledger
from before the v0.0.46 sync (fork names at 55–60) now stop at the startup check; start the
v0.0.46 fork build on them once first.

On every sync where upstream adds a migration numbered below the fork's last one, or where
numbers clash:

1. Take upstream's files and numbers as they are.
2. Move fork migrations to numbers after upstream's last one. Keep them idempotent
   (`IF NOT EXISTS`, or a `PRAGMA table_info` check).
3. Update `reconcileForkMigrationLedger.ts`: apply each upstream migration a fork database
   skipped, safely twice, then move the fork ledger rows to their new ids. It must run before
   the startup check, so a repair migration is no longer enough.
4. Test on a `VACUUM INTO` copy of `~/.t3/userdata/state.sqlite`, never on the live file.

## Hot files

Many fork entries touch these files. Expect conflicts here on each sync.

| File                                                       | Entries                                      |
| ---------------------------------------------------------- | -------------------------------------------- |
| `apps/web/src/components/ChatView.tsx`                     | Message fork                                 |
| `apps/web/src/components/chat/MessagesTimeline.tsx`        | Message fork, Branding                       |
| `apps/web/src/components/chat/TimelineUserMessageRow.tsx`  | Message fork, Branding                       |
| `apps/web/src/components/Sidebar.tsx`                      | Agent threads, Sidebar filter, Sidebar style |
| `apps/web/src/components/sidebar/SidebarThreadRow.tsx`     | Agent threads, Sidebar style, Branding       |
| `apps/web/src/components/pullRequest/PullRequestsPage.tsx` | Sidebar filter                               |
| `apps/web/src/index.css`                                   | Sidebar style, Radius, Quieter tool rows     |
| `apps/server/src/ws.ts`                                    | Agent ports, GitHub account                  |
| `apps/server/src/persistence/Migrations.ts`                | [Migrations](#migrations)                    |
| `apps/server/src/pullRequest/PullRequestService.ts`        | GitHub account per repo, Pull request stacks |

## Remote server (VPS) deploy

The fork's server side (GitHub account per repo, agent ports, and repair migrations 61–68)
only runs on a machine that has the **fork build**. Every path that
installs a server for you pulls **upstream** `t3` from npm instead: `npx t3 …`,
`t3 service install|update`, and the desktop "SSH environment" mode. Upstream looks the
same in the app, so the gap shows up late as "No skills found" or no per-repo PR list.

Learned on 2026-09-12 while setting up a root-login VPS (Ubuntu 24.04, Node 22).

Since the v0.0.45 sync (new orchestrator) the repo's dev tooling needs Node 24
(`engines.node ^24.13.1` in the root `package.json`); build on the Mac with
`PATH=/opt/homebrew/opt/node@24/bin:$PATH`. The server package still accepts Node 22.16+, so the
VPS keeps Node 22. The first start copies
`userdata/state.sqlite` into a new `userdata/statev2.sqlite` once and runs from the copy, so the
old file stays as a rollback point for the previous build.

### Build and ship (Mac → server)

`~/spindle/deploy.sh` on the Mac does all of this in one command (about 5 minutes).
Move it into `scripts/` when it stabilises.

1. `vp run --filter t3 build` — builds the web UI and bundles it into `apps/server/dist`.
2. `cd apps/server && npm pack` — `pnpm pack` fails without a full `pnpm install`
   (workspace devDependencies). `npm pack` works but copies `"catalog:"` specifiers as is,
   and npm on the server rejects them (`Unsupported URL Type "catalog:"`). Rewrite each one
   with the version from `pnpm-workspace.yaml` (`[catalog]`) and drop `devDependencies`.
3. On the server: `cd ~/spindle/runtime/<version> && npm install <tgz>`, then apply the
   repo's `patches/*.patch` to the installed runtime packages with `patch -p1` (npm ignores pnpm
   patches; without the `@ff-labs/fff-node` one the server dies at boot with
   `ERR_PACKAGE_PATH_NOT_EXPORTED`). `<version>` must equal `apps/server/package.json`. Never
   install into `~/.t3/runtime/versions/<version>`: that folder belongs to the upstream SSH
   launcher (`run-t3.sh`), which drops its native `t3` there and starts it on 3774. Those
   folders stay `chattr +i` (locked) all the time, deploys included.
4. Point the systemd unit at the slot and restart: `ExecStart=/usr/local/bin/node
   ~/spindle/runtime/<version>/node_modules/t3/dist/bin.mjs serve`, then
   `systemctl --user daemon-reload && systemctl --user restart t3code`. Since upstream 0.0.42 the
   launcher (`t3 __service-launcher`, protocol 3) only starts a standalone `t3` executable, so the
   old `~/.t3/runtime/service-launcher.mjs` and `service-state.json` are no longer used; the
   server runs unmanaged (no self-update, which the rules below forbid anyway). Keep the runtime's
   `node_modules` — `node-pty` is compiled there.
   - Since upstream 0.1.x the leftover `service-state.json` **blocks startup**: the ownership
     guard (`apps/server/src/serverOwnership.ts`, `olderBootServiceHome`) reads the unit's
     `T3CODE_HOME` base dir, finds `runtime/service-state.json` with `activeVersion: "0.0.42"`,
     and exits with `OlderBootServiceError` (status 78, `Restart=always` loops). Delete the file
     on the first 0.1.x deploy; `deploy.sh` does it now.
   - Wait for readiness instead of a fixed sleep. Migrations on the 4 GB VPS database took about
     3.5 minutes on the 0.1.1 deploy, so a 10-second health check prints `http 000` while the
     server is still migrating. `deploy.sh` polls `/` for up to 10 minutes.

### Which side needs a rebuild

- Server-side change (`apps/server`, migrations, server bits of `packages/*`): run the deploy
  script. The installed desktop app keeps working against the new server.
- Client-side change (`apps/web`, `apps/desktop`, `packages/client-runtime`, client bits of
  `packages/contracts`): build and install a new desktop app, `vp run dist:desktop:dmg`. The
  build folder needs `.env` (copy `~/t3code/.env` into a worktree first); see
  [Desktop build needs `.env`](#desktop-build-needs-env-direct-commit). The
  server needs no deploy for that, unless contracts changed what the server sends (then both).
- Mobile (`apps/mobile`): a new mobile build, see `docs/user/install.md`.

### Rules on the server

- Never run `npx t3 service update` there; it replaces the slot with upstream.
- Never add the VPS as a desktop "SSH environment"; use T3 Connect only. Since 0.0.42 the SSH
  launch also replaces the runtime slot with upstream's binary (2026-09-17, 2026-09-19). The
  old reason still applies: its launch
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
  `apps/server/src/provider/ProviderRegistry.ts` (`mergeProviderSnapshot`, and the `baseline`
  compare in the per-cwd scan).
- Tests: `apps/server/src/serverRuntimeState.test.ts`,
  `apps/server/src/provider/ProviderRegistry.test.ts`.
- Check: add a skill dir under `~/.claude/skills`, Settings → Providers → Refresh, open a
  thread in that project, type `$` — the skill is listed. Restart the service while the
  desktop SSH environment is connected: `ss -ltnp | grep 377` still shows only 3773.
- Drop when: upstream guards the runtime-state clear by pid and invalidates workspace
  snapshots on refresh.

### Agent thread tools (#37; on upstream's tools since v0.0.45)

- What: upstream's new orchestrator ships its own agent tools (`t3_thread_launch`,
  `create_threads`, `delegate_task`, `t3_thread_send/read/list`, `orchestrator_capabilities`),
  so the fork's own toolkit is gone. The fork adds three things on top of upstream's tools:
  (1) a one-level limit: a thread an agent started (`createdBy: "agent"`) or a delegated child
  (`lineage.relationshipToParent: "subagent"`) cannot launch, create, delegate or schedule new
  threads; it can still read, rename and link pull requests. (2) Settings → thread routing notes
  are returned as `routingNotes` by `orchestrator_capabilities`, and its tool description tells
  agents to follow them. (3) Web and mobile mark threads with `createdBy === "agent"`.
- Key files: `apps/server/src/mcp/threadStartLimit.ts`, `mcp/OrchestratorMcpService.ts`
  (`delegateTask`, `createThreads`, `scheduleTask`, `updateScheduledTask`),
  `mcp/toolkits/project/handlers.ts` (`t3_thread_launch`), `mcp/toolkits/orchestrator/{handlers,tools}.ts`,
  `packages/contracts/src/orchestratorMcp.ts` (`routingNotes`), `orchestration-v2/legacy/LegacyV1ThreadImporter.ts`
  (v1 `parent_thread_id` → `createdBy: "agent"`), `packages/client-runtime/src/state/models.ts`
  (`createdBy` on the client shell), web `sidebar/SidebarThreadRow.tsx` (the mark moved there when
  upstream extracted the row on 2026-10-21), mobile `thread-list-v2-items.tsx`.
- Tests: `apps/server/src/mcp/threadStartLimit.test.ts`, `OrchestratorMcpToolkit.integration.test.ts`
  (`routingNotes`).
- Check: from a person-started thread, ask the agent for a separate thread; it appears with the
  agent mark. Ask that child to start another thread; it gets `capability_denied`. Change routing
  notes in Settings and confirm `orchestrator_capabilities` returns the new text.
- Drop when: upstream adds a depth limit and routing preferences of its own.

## Transcripts

### Fork from a message (#3; chat fork only since v0.0.45)

- What: the message actions menu can fork the conversation through a selected user or assistant
  message. **Fork to new chat** opens a draft in the same checkout with the full saved
  user/assistant transcript through that message, and keeps the source model. Upstream's own
  **Fork from this response** button (assistant messages, provider-side context) also shows.
  **Fork to new workspace** (worktree at the message's checkpoint) was dropped in the v0.0.45 sync
  because the user did not use it; the compaction variants from #32/#34/#35 stay dropped.
- Key files: `packages/client-runtime/src/{forkTranscript,state/fullThreadHistory}.ts`,
  `apps/web/src/components/ChatView.tsx` (`onForkMessage`, no `try/finally`: see Sync step 5),
  `apps/web/src/components/chat/{MessagesTimeline,timelineRowContext,TimelineUserMessageRow}.tsx`
  (`onForkMessage` and the `MessageForkMenu` action, which upstream's 2026-10-21 sync moved out of
  `MessagesTimeline.tsx` into the user-message row),
  `apps/web/src/components/chat/{MessagesTimeline,MessagesTimeline.logic}.ts{x,}`,
  `apps/web/src/state/threads.ts` (`loadFullThreadHistory`).
- Tests: `forkTranscript.test.ts`, `MessagesTimeline.logic.test.ts`.
- Check: fork an earlier user message to a new chat and confirm the draft ends at that message
  and uses the same model. Confirm the menu has no workspace or compaction actions.
- Drop when: upstream forks from user messages into an editable draft.

### Copy full transcript (#24)

- What: the thread menu copies the full thread transcript. The full history comes from the
  server's thread snapshot endpoint (`fetchEnvironmentThreadSnapshot`), not the bounded client
  window.
- Key files: `packages/client-runtime/src/{threadTranscript,state/fullThreadHistory}.ts`,
  `apps/web/src/components/threadTranscriptCopy.ts`, `threadActionMenu.logic.ts`, `Sidebar.tsx`.
- Tests: `threadTranscript.test.ts`, `threadActionMenu.logic.test.ts`.
- Check: right-click a thread and copy the transcript. Paste shows all turns.
- Warning: mobile `use-copy-thread-transcript.ts` is up to date but has no menu entry; it lost
  its caller in an earlier sync.
- Drop when: upstream adds a copy transcript action.

## Composer

### Composer triggers anywhere (#12)

- What: `/` and `@` open their menus in the middle of text, not only at the start.
- Key files: `packages/shared/src/composerTrigger.ts`, `apps/web/src/composer-logic.ts`.
- Tests: `composerTrigger.test.ts`, `composer-logic.test.ts`.
- Check: type `please use /` in the middle of a sentence. The skills menu opens.

## Sidebar

### Multi-project filter (#20, #33)

- What: filter the sidebar and the pull request list by several projects at once.
- Key files: `apps/web/src/components/Sidebar.logic.ts`, `Sidebar.tsx`,
  `components/pullRequest/{PullRequestsPage.tsx,usePullRequestListView.ts}` (the page body; since
  the 2026-10-21 sync `_chat.pull-requests.tsx` only validates search),
  `components/pullRequest/{PullRequestListFilters.tsx,pullRequestList.logic.ts,pullRequestListPreferences.ts}`,
  `apps/web/src/routes/_chat.pull-requests.tsx`.
- Tests: `Sidebar.logic.test.ts`, `pullRequestList.logic.test.ts`. (Upstream deleted
  `PullRequestListFilters.test.tsx` on 2026-10-21 and the new rules reject the element-walking
  style it used, so the multi-select itself is covered by the logic tests only.)
- Check: pick two projects in each filter. Only those threads and pull requests show.
- Sync note: upstream compiles the sidebar and the pull requests page with the React Compiler
  and no manual `useMemo`/`useCallback`. The fork's scope lives in the same plain style: the PR
  page's `usePullRequestScope` reads `projectIds`, and the sidebar passes the sorted scope keys
  as `projectScopeKey` to `useSidebarThreads`.
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

### Host usage in the ports popover (#44 follow-up)

- What: each environment header in the "Agent ports" popover shows a small line with the host's
  CPU, RAM and disk usage, e.g. `CPU 12% · RAM 48% · Disk 63%`. Linux servers read `/proc/stat`
  (CPU, compared with the previous scan), `/proc/meminfo` (RAM) and `df -P -k /` (root disk). macOS
  and Windows send nothing, so a local Mac shows no line. No new button, popover, RPC or polling:
  the numbers ride on `agentPorts.list`, which the popover already refreshes every 4 s.
- Key files: `packages/contracts/src/agentPorts.ts` (`AgentPortsUsage`, optional `usage`),
  `apps/server/src/ports/AgentPortsService.ts` (`parseProcStatCpu`, `parseProcMeminfo`,
  `parseDfCapacity`, `readHostUsage`), `apps/web/src/agentPorts.logic.ts`
  (`formatAgentPortsUsage`), `apps/web/src/components/sidebar/SidebarPortsPill.tsx`.
- Tests: `AgentPortsService.test.ts`, `agentPorts.logic.test.ts`.
- Check: open the popover against the VPS; the environment header shows CPU/RAM/Disk. CPU is blank
  on the first scan and fills in on the next 4 s tick. A Mac environment shows no line.
- Warning: both sides change. An old server omits `usage` and the line simply does not render.
- Drop when: upstream shows host resources in the app on its own.

### Sidebar look (#6, #8, #22, #23)

- What: taller sidebar rows, and sidebar text one step smaller than the center panel. The
  smaller text comes from a single rule in `index.css` that scales the Tailwind `--text-xs`,
  `--text-sm` and `--text-base` variables by `--sidebar-text-scale` (0.85) inside
  `[data-slot="sidebar"]`, so every `text-*` utility in the sidebar scales without touching
  component files. Change the one scale value to retune the size. The update pill shows only
  when an update needs action. No working circle in statuses. No provider icon at the end of
  thread rows (the hover tooltip still names the provider and model).
- Key files: `apps/web/src/index.css`, `Sidebar.tsx`, `sidebar/SidebarUpdatePill.tsx`.
- Check: compare row height with the pre-sync build; sidebar thread titles must read smaller
  than the chat text next to them.
- Drop when: upstream ships its own smaller sidebar type scale.

### Quieter tool and thinking rows (direct commit)

- What: tool, command, thinking and status rows in the chat timeline ("Ran 4 commands",
  "Running python3", "Thinking", "Thought", "Working for 2m", "Worked for 5m") render at 85% size and 60% opacity, back to full opacity on
  hover or focus, so they stand apart from the assistant's prose. One CSS rule in `index.css`
  keyed off the `data-timeline-row-kind` / `data-message-role` attributes the timeline already
  renders; no component file changes. Change `zoom` or `opacity` there to retune it.
- Key files: `apps/web/src/index.css`.
- Check: in a thread with tool calls, the summary rows read smaller and dimmer than the
  assistant text, and brighten under the pointer.
- On a conflict: if upstream renames those row attributes, the rows silently return to full
  size; update the selectors in the rule.
- Drop when: upstream ships its own quieter styling for tool rows.

## Git and GitHub

### GitHub account per repo (#1)

- What: `git config gh.account <user>` picks the `gh` login for every GitHub API request about
  that repository (pull requests and source control). It wins over upstream's per-host choices
  (Settings → Source Control account or token, `GH_TOKEN`) and does not fall back to another login.
  A missing login fails with `GitHubNotSignedInError` `fromRepository: true`, which names the
  account and counts as a plain failure, so one repository cannot mark the whole host signed out.
- How: upstream calls the GitHub API directly since v0.0.46 (`GitHubRest` and the
  `effect/graphql` client since v0.1, plus `GitHubCredentials`), so
  the fork no longer edits a `gh` wrapper. `GitHubAccount.scopeToRepositoryAccounts` wraps each
  service method that takes a `cwd` and sets the `RepositoryGitHubAccount` reference;
  `GitHubCredentials.get` reads it. The wrapper lives outside upstream's `make` bodies
  (`makeWithRepositoryAccounts` in `GitHubPullRequestApi.ts` and
  `GitHubSourceControlProvider.ts`) to keep the diff small. Request batches key on the account
  too (`gitHubGraphQlClient.ts` `batchKey`), so two accounts never share one GraphQL batch.
- Since the 2026-10-10 sync the GitHub code lives in `packages/source-control-github`, which may
  only reach the server through `SourceControlHost`. `GitHubAccount` reads `git config` through
  `SourceControlHost.process`. `driver.ts` uses `makeWithRepositoryAccounts`, and the server's
  `builtInDrivers.ts` uses `GitHubPullRequestApi.layerWithRepositoryAccounts`. Upstream's plain
  `layer` stays unwrapped: its test host stops on any unexpected `git` call.
- Key files: `packages/source-control-github/src/server/{GitHubAccount,GitHubCredentials,GitHubSourceControlProvider,GitHubPullRequestApi,GitHubPullRequestProvider,driver}.ts`,
  `apps/server/src/sourceControl/builtInDrivers.ts`,
  `apps/server/src/pullRequest/{PullRequestProvider,PullRequestService}.ts`,
  `docs/user/source-control.md`.
- Tests: `GitHubAccount.test.ts`, `GitHubCredentials.test.ts`, `PullRequestService.test.ts`.
- Sync note: upstream groups viewer lookups by host. The fork groups them by
  (host, kind, account key), so `SupportedProject` carries `viewerAccountKey`, the project scan is
  an `Effect.forEach` that can call `api.getViewerAccountKey`, and the cache is `viewersByAccount`.
  Keep that shape and re-apply upstream's changes on top of it.
- Check: in a repo with `gh.account` set to a non-default account, the pull request list loads.
- Drop when: upstream supports several `gh` accounts.

### No `t3code/` worktree branch prefix (#2)

- What: upstream now has a branch naming setting; the fork changes its default prefix from
  `t3` (upstream's default since v0.0.46) to empty, so generated branches have no prefix. Temporary placeholder branches still
  use `t3code/<hex>` until the server renames them. A saved prefix in Settings still wins.
- Key files: `packages/contracts/src/settings.ts` (`branchNamePrefix` default).
- Tests: `packages/contracts/src/settings.test.ts`.
- Check: start a new worktree thread. After the first turn, the branch name has no `t3code/` prefix.

## Look and feel

### Corner radius (#9; #36 reverted by #39)

- What: a smaller border radius across the app. The composer radius was restored once after a sync,
  and again when the upstream composer footer came back (`rounded-3xl` in `ComposerSurface.tsx`).
  The composer input surface in `ChatComposer.tsx` was a hardcoded `rounded-[20px]`, so it ignored
  the token and looked rounder than its own frame; it now uses
  `rounded-(--chat-composer-inner-corner)`, a variable `ComposerSurface.tsx` sets to the composer
  corner minus 1px. Upstream's `shadcn/no-arbitrary-values` lint rule (v0.0.45) fails on
  `rounded-[calc(...)]` and `text-[11px]`-style classes, so fork classes must use theme tokens
  or `(--var)` shorthands.
- Key files: `apps/web/src/index.css`, `chat/{ChatComposer,ComposerBanner,ComposerSurface,ProposedPlanCard}.tsx`.
- Check: the composer and cards have the smaller radius, and the input corners match the composer frame.
- The composer glass backdrop is drawn with `clip-path: shape()`, so its corners cannot inherit
  `rounded-*`. `ComposerSurface.tsx` now defines `--chat-composer-corner` (`--radius-3xl`) and
  `--chat-composer-strip-corner` (`--radius-2xl`) plus their `*-control` bezier offsets
  (`corner * 0.4477`), and the shape, the seam polygon and the strip use those instead of the
  old literal `22px`/`9.85px`/`16px`/`7.16px`. Upstream's literals were also 2px off its own
  `rounded-3xl`, so take upstream's shape on a conflict and re-apply the variables.
- Warning: upstream often changes radius tokens. Take upstream's token names, then set the fork values again.

### Branch names in the code font (#10)

- Key files: `apps/web/src/components/BranchPicker.tsx`, `Sidebar.tsx`, `ThreadCommandSubtitle.tsx`.
- Upstream renders branch names through `ui/middle-truncate.tsx`, and its `no-restyle` lint rule
  forbids `font-mono` on `<MiddleTruncate>`. The fork puts `font-mono` on a plain wrapper span (or
  the parent) instead. On a conflict, take upstream's markup and add `font-mono` to that wrapper.
- The branch selector's own trigger label is deliberately _not_ in the code font: that spot took
  upstream wholesale in the 2026-09-21 sync, since the label doubles as the "Select ref" placeholder.

### App name without a stage suffix (#43)

- What: the stable desktop build is named `Spindle`, not `Spindle (Beta)`. Dev and Nightly keep
  their suffix so builds stay easy to tell apart. Upstream's stable stage label is `Beta` since
  v0.1 (`Alpha` before); only the display name drops it. Upstream renaming the stage again
  silently brings the suffix back, so check the `=== "Beta"` tests after each sync.
- Key files: `apps/desktop/package.json` (`productName`), `apps/desktop/src/app/DesktopEnvironment.ts`,
  `apps/desktop/src/app/DesktopAppIdentity.ts` (the runtime `setName` is `Spindle` for the stable
  build; upstream uses `<base> <stage>` so the User-Agent token stays valid, and `Spindle` is valid),
  `apps/desktop/scripts/electron-launcher.mjs`, `apps/web/src/branding.logic.ts`, `apps/web/index.html`.
- Tests: `apps/web/src/branding.test.ts`, `apps/desktop/src/app/{DesktopEnvironment,DesktopAppIdentity}.test.ts`,
  `scripts/build-desktop-artifact.test.ts` (the identity test also fixes the legacy user-data path,
  which is `T3 Code (Alpha)` on real installs).
- Check: the menu bar, window title, and About panel say `Spindle`; a `-nightly` version says `Spindle (Nightly)`.
- Warning: the app bundle is `Spindle.app`. Remove the old `Spindle (Alpha).app` by hand after
  the first install. User data is not affected (it lives under `~/.t3`).

### Hide "Add action" until a project has actions (direct commit)

- Key files: `apps/web/src/components/chat/ThreadDetailsPanel.tsx`.
- Check: a project with no actions (neither saved nor in a checked-in `t3.json`) shows no
  "Add action" in the thread details panel.
- Upstream moved project actions from the chat header into the thread details panel. The guard
  renders `ProjectScriptsControl` only when the project has saved scripts or `t3.json` scripts.

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

### Desktop build needs `.env` (direct commit)

- What: the T3 Connect UI exists only when the build has `T3CODE_CLERK_PUBLISHABLE_KEY`,
  `T3CODE_CLERK_JWT_TEMPLATE` and `T3CODE_RELAY_URL` (`hasCloudPublicConfig()`), read from the
  checkout's git-ignored `.env`. A DMG built in a worktree or fresh clone has no `.env`, so the
  app has no "Sign in to T3 Connect" button and every T3 Connect environment shows "Your cloud
  sign-in changed". Happened on 2026-09-13, 2026-09-17 and 2026-09-24. The desktop build now
  stops early and names the missing keys; `T3CODE_ALLOW_BUILD_WITHOUT_CLOUD=1` skips the check.
- Key files: `scripts/lib/cloud-config-guard.ts`, `scripts/build-desktop-artifact.ts`
  (`buildDesktopArtifact`, `DesktopBuildCloudConfigMissingError`).
- Tests: `scripts/lib/cloud-config-guard.test.ts`.
- Check: after a build, `grep -a -c relay.t3.codes Spindle.app/Contents/Resources/app.asar`
  inside the mounted DMG is above 0.
- Drop it when: never, while the fork builds its own desktop app.

### Desktop build needs Xcode's `actool` on PATH (sync/v0.1.1)

- What: upstream 0.1.x packages the app from `assets/<channel>/app-icon.icon` (Icon Composer)
  instead of a `.icns`, and electron-builder compiles it with `actool`. That tool only ships
  inside Xcode, so a Mac whose `xcode-select` points at the Command Line Tools fails the DMG
  step with `Failed to check actool version. Is Xcode 26 or higher installed?` even with Xcode
  installed. Make it reachable for the build:
  `PATH="/Applications/Xcode.app/Contents/Developer/usr/bin:$PATH" vp run dist:desktop:dmg`,
  or switch the machine once with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.
- Key files: `assets/{prod,nightly,dev}/app-icon.icon`, `scripts/build-desktop-artifact.ts`
  (`mac.icon` in the generated builder config).
- Check: the DMG step logs no `actool` error and finishes with the `T3-Code-<version>-arm64.dmg`
  artifact list.
- Warning: the guard lives in `app-builder-lib`, so a dependency bump can change which tools it
  needs. Upstream CI uses Xcode 26; keep the local Xcode at 26 or newer.
