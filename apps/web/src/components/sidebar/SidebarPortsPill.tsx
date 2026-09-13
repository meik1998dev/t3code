/**
 * Sidebar footer button that lists the ports agent sessions opened on every
 * connected environment. Each environment's server does the detection
 * (see `apps/server/src/ports/AgentPortsService.ts`); this popover groups the
 * results per environment, names the thread or project behind each port, and
 * opens or tunnels it.
 *
 * The "All ports" switch asks the same scan to keep system listeners as well
 * (a distro postgres, another service). Those rows are read-only: the stop
 * button is agent-only, on the client and again on the server.
 *
 * Queries are mounted only while the popover is open, so the 4 s polling
 * stops as soon as it closes.
 */
import {
  agentPortLocalUrl,
  agentPortTunnelCommand,
  type AgentPort,
  type AgentPortsScope,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { CopyIcon, EthernetPortIcon, ExternalLinkIcon, SquareIcon } from "lucide-react";
import * as Option from "effect/Option";
import { memo, useCallback, useMemo, useState } from "react";

import {
  collectAgentPortCwdRoots,
  formatAgentPortCommand,
  formatAgentPortCwd,
  resolveAgentPortOwner,
  type AgentPortOwner,
} from "../../agentPorts.logic";
import { useOpenLink } from "../../browser/useOpenLink";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn } from "../../lib/utils";
import { resolveRemoteOpenState, type RemoteOpenState } from "../../remoteOpen";
import { agentPortsEnvironment } from "../../state/agentPorts";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments, type EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const PORTS_SCOPE_KEY = "t3code:agent-ports:show-all";

function copyText(title: string, value: string): void {
  void navigator.clipboard.writeText(value).then(
    () => {
      toastManager.add({ type: "success", title: `${title} copied`, description: value });
    },
    () => {
      toastManager.add({ type: "error", title: `Could not copy ${title.toLowerCase()}` });
    },
  );
}

function ownerLabel(owner: AgentPortOwner | null, cwd: string | null): string | null {
  if (owner === null) return formatAgentPortCwd(cwd);
  if (owner.kind === "project") return owner.title;
  return owner.projectTitle === null ? owner.title : `${owner.projectTitle} · ${owner.title}`;
}

const AgentPortRow = memo(function AgentPortRow({
  environmentId,
  port,
  owner,
  remote,
  cwdRoots,
}: {
  environmentId: EnvironmentId;
  port: AgentPort;
  owner: AgentPortOwner | null;
  remote: RemoteOpenState;
  cwdRoots: ReadonlyArray<string>;
}) {
  const openLink = useOpenLink(null);
  const stopPort = useAtomCommand(agentPortsEnvironment.stop, { reportFailure: false });
  const [isStopping, setIsStopping] = useState(false);
  const url = agentPortLocalUrl(port.port);
  const threadRef = owner?.kind === "thread" ? { environmentId, threadId: owner.threadId } : null;
  // A remote port is reachable from here only through the thread's in-app
  // browser (it runs on the environment) or an SSH tunnel.
  const remoteHost = remote.mode === "remote-links" ? remote.host.host : null;
  const tunnel =
    remoteHost === null ? null : agentPortTunnelCommand({ port: port.port, sshHost: remoteHost });
  const canOpenHere = remote.mode === "local-exec" || threadRef !== null;

  const handleOpen = useCallback(() => {
    if (canOpenHere) {
      void openLink(url, threadRef === null ? {} : { threadRef }).catch(() => {
        toastManager.add({ type: "error", title: `Could not open ${url}` });
      });
      return;
    }
    if (tunnel !== null) copyText("Tunnel command", tunnel);
  }, [canOpenHere, openLink, threadRef, tunnel, url]);

  const handleCopy = useCallback(() => {
    if (tunnel !== null) {
      copyText("Tunnel command", tunnel);
      return;
    }
    copyText("URL", url);
  }, [tunnel, url]);

  const handleStop = useCallback(() => {
    if (isStopping) return;
    setIsStopping(true);
    void stopPort({
      environmentId,
      input: { pid: port.pid, port: port.port, cwdRoots },
    })
      .then((result) => {
        if (result._tag === "Success" && result.value.stopped) {
          toastManager.add({ type: "success", title: `Stopped :${port.port}` });
          return;
        }
        toastManager.add({
          type: "error",
          title: `Could not stop :${port.port}`,
          description:
            result._tag === "Success"
              ? "The process is not an agent port any more. The list was refreshed."
              : "The environment did not accept the request.",
        });
      })
      .finally(() => setIsStopping(false));
  }, [cwdRoots, environmentId, isStopping, port.pid, port.port, stopPort]);

  const canStop = port.origin !== "system";
  const owned = ownerLabel(owner, port.cwd);
  const primaryTitle = canOpenHere
    ? `Open ${url}`
    : tunnel === null
      ? "No SSH route to this environment"
      : `Copy: ${tunnel}`;

  return (
    <div className="group/port flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-sidebar-row-hover">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left outline-hidden"
              onClick={handleOpen}
            >
              <span className="w-14 shrink-0 font-mono text-xs tabular-nums text-sidebar-foreground">
                :{port.port}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs text-sidebar-foreground">
                  {formatAgentPortCommand(port)}
                </span>
                {owned !== null ? (
                  <span className="truncate text-[11px] text-muted-foreground">{owned}</span>
                ) : null}
              </span>
              {canOpenHere ? (
                <ExternalLinkIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground opacity-0 group-hover/port:opacity-100"
                />
              ) : null}
            </button>
          }
        />
        <TooltipPopup align="start" className="max-w-80 break-all" side="top">
          {primaryTitle}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={tunnel === null ? "Copy URL" : "Copy SSH tunnel command"}
              className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground opacity-0 outline-hidden hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/port:opacity-100"
              onClick={handleCopy}
            >
              <CopyIcon aria-hidden="true" className="size-3.5" />
            </button>
          }
        />
        <TooltipPopup align="end" className="max-w-80 break-all" side="top">
          {tunnel === null ? "Copy URL" : "Copy SSH tunnel command"}
        </TooltipPopup>
      </Tooltip>
      {canStop ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`Stop the process on port ${port.port}`}
                aria-disabled={isStopping || undefined}
                className={cn(
                  "inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground outline-hidden focus-visible:opacity-100 group-hover/port:opacity-100",
                  isStopping
                    ? "cursor-progress opacity-100"
                    : "cursor-pointer opacity-0 hover:text-destructive",
                )}
                onClick={handleStop}
              >
                <SquareIcon aria-hidden="true" className="size-3 fill-current" />
              </button>
            }
          />
          <TooltipPopup align="end" side="top">
            {isStopping ? "Stopping…" : `Stop ${formatAgentPortCommand(port)} (pid ${port.pid})`}
          </TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
});

const EnvironmentPortsSection = memo(function EnvironmentPortsSection({
  environment,
  scope,
}: {
  environment: EnvironmentPresentation;
  scope: AgentPortsScope;
}) {
  const environmentId = environment.environmentId;
  const projects = useProjects();
  const threads = useThreadShells();
  const connected = environment.connection.phase === "connected";
  const cwdRoots = useMemo(
    () => collectAgentPortCwdRoots({ environmentId, projects, threads }),
    [environmentId, projects, threads],
  );
  const query = useEnvironmentQuery(
    connected ? agentPortsEnvironment.list({ environmentId, input: { cwdRoots, scope } }) : null,
  );
  const remote = useMemo(() => {
    const profile = Option.getOrNull(environment.entry.profile);
    return resolveRemoteOpenState({
      target: environment.entry.target,
      sshAlias:
        profile !== null && profile._tag === "SshConnectionProfile" ? profile.target.alias : null,
      remoteOpenTargets: environment.serverConfig?.remoteOpenTargets,
      isDesktopRenderer: window.desktopBridge !== undefined,
    });
  }, [environment]);

  const ports = query.data?.ports ?? [];
  const count = ports.length;

  const status = !connected
    ? "offline"
    : query.error !== null
      ? "unavailable"
      : query.data === null
        ? "scanning…"
        : !query.data.supported
          ? "not supported here"
          : count === 0
            ? scope === "all"
              ? "no ports"
              : "no agent ports"
            : null;

  return (
    <section aria-label={`${environment.label} ports`} className="flex flex-col gap-0.5">
      <header className="flex items-center justify-between gap-2 px-1 pt-1 pb-0.5">
        <span className="truncate text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {environment.label}
        </span>
        {status !== null ? (
          <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span>
        ) : (
          <span className="shrink-0 text-[11px] text-muted-foreground">{count}</span>
        )}
      </header>
      {ports.map((port) => (
        <AgentPortRow
          key={`${port.pid}:${port.port}`}
          environmentId={environmentId}
          port={port}
          owner={resolveAgentPortOwner({ environmentId, cwd: port.cwd, projects, threads })}
          remote={remote}
          cwdRoots={cwdRoots}
        />
      ))}
    </section>
  );
});

export function SidebarPortsPill() {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useLocalStorage(PORTS_SCOPE_KEY, false, Schema.Boolean);
  const { environments } = useEnvironments();
  const scope: AgentPortsScope = showAll ? "all" : "agent";
  const tooltip = "Agent ports";

  const trigger = (
    <button
      type="button"
      aria-label={tooltip}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-full outline-hidden ring-ring transition-colors focus-visible:ring-2",
        open
          ? "bg-sidebar-control-surface text-sidebar-foreground"
          : "text-[var(--sidebar-icon-color)] hover:bg-sidebar-row-hover hover:text-sidebar-foreground",
      )}
    >
      <EthernetPortIcon aria-hidden="true" className="size-4" />
    </button>
  );

  return (
    <SidebarMenuItem className="ml-auto shrink-0">
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip disabled={open}>
          <TooltipTrigger render={<PopoverTrigger render={trigger} />} />
          <TooltipPopup align="center" side="top">
            {tooltip}
          </TooltipPopup>
        </Tooltip>
        <PopoverPopup
          align="end"
          aria-label={showAll ? "All ports" : "Agent ports"}
          className="w-80 max-w-[calc(100vw-2rem)] p-1.5"
          side="top"
        >
          <div className="flex items-center justify-between gap-2 px-1 pb-1">
            <span className="text-xs font-medium text-sidebar-foreground">
              {showAll ? "All ports" : "Agent ports"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">refreshes every 4 s</span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-pressed={showAll}
                      className={cn(
                        "cursor-pointer rounded px-1.5 py-0.5 text-[11px] outline-hidden ring-ring focus-visible:ring-2",
                        showAll
                          ? "bg-sidebar-control-surface text-sidebar-foreground"
                          : "text-muted-foreground hover:text-sidebar-foreground",
                      )}
                      onClick={() => setShowAll(!showAll)}
                    >
                      All
                    </button>
                  }
                />
                <TooltipPopup align="end" side="top">
                  {showAll
                    ? "Show only ports agent sessions opened"
                    : "Show every listening port, system services included"}
                </TooltipPopup>
              </Tooltip>
            </div>
          </div>
          {open ? (
            <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {environments.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">No environments.</p>
              ) : (
                environments.map((environment) => (
                  <EnvironmentPortsSection
                    key={environment.environmentId}
                    environment={environment}
                    scope={scope}
                  />
                ))
              )}
            </div>
          ) : null}
        </PopoverPopup>
      </Popover>
    </SidebarMenuItem>
  );
}
