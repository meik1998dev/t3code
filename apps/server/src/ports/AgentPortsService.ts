/**
 * AgentPortsService - lists TCP listeners that agent sessions opened on this
 * environment (dev servers, previews, test databases).
 *
 * Detection is live, no bookkeeping:
 *  1. `lsof -iTCP -sTCP:LISTEN -P -n -F pcn` gives every listener with its pid.
 *  2. `ps -A -o pid=,ppid=,args=` gives the process tree and command lines.
 *  3. `lsof -a -p <pids> -d cwd -F pn` gives each listener's working directory.
 *
 * A listener is kept when its process descends from this server process
 * (agents and their shells are children of it) — origin `agent-process` — or
 * when its cwd is inside one of the client's workspace roots, which catches
 * servers that were detached and reparented — origin `workspace`. The server's
 * own listeners and everything else on the machine are dropped.
 *
 * Windows has no lsof; the list is empty with `supported: false`.
 */
import {
  AGENT_PORTS_COMMAND_MAX_LENGTH,
  type AgentPort,
  type AgentPortOrigin,
  type AgentPortsList,
  type AgentPortsListInput,
} from "@t3tools/contracts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";

export class AgentPortsService extends Context.Service<
  AgentPortsService,
  {
    readonly list: (input: AgentPortsListInput) => Effect.Effect<AgentPortsList>;
  }
>()("t3/ports/AgentPortsService") {}

/** Pid of the process that owns the agent sessions; tests override it. */
export const AgentPortsServerPid = Context.Reference<number>("t3/ports/AgentPortsServerPid", {
  defaultValue: () => process.pid,
});

const PROBE_TIMEOUT = Duration.seconds(5);
const PROBE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export interface ListeningSocket {
  readonly pid: number;
  readonly processName: string | null;
  readonly host: string;
  readonly port: number;
}

export interface ProcessRecord {
  readonly pid: number;
  readonly ppid: number;
  readonly command: string | null;
}

/** `lsof -F pcn`: `p<pid>` starts a process, `c<name>` names it, `n<host:port>` is a socket. */
export function parseLsofListeners(stdout: string): ReadonlyArray<ListeningSocket> {
  const sockets: Array<ListeningSocket> = [];
  const seen = new Set<string>();
  let pid: number | null = null;
  let processName: string | null = null;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length < 2) continue;
    const prefix = line[0];
    const value = line.slice(1);
    if (prefix === "p") {
      const parsed = Number.parseInt(value, 10);
      pid = Number.isInteger(parsed) && parsed > 0 ? parsed : null;
      processName = null;
      continue;
    }
    if (prefix === "c") {
      processName = value.trim() || null;
      continue;
    }
    if (prefix !== "n" || pid === null) continue;
    const separator = value.lastIndexOf(":");
    if (separator <= 0) continue;
    const port = Number.parseInt(value.slice(separator + 1), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const host = value.slice(0, separator).trim() || "*";
    // lsof prints IPv4 and IPv6 sockets separately; one row per pid+port is enough.
    const key = `${pid}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sockets.push({ pid, processName, host, port });
  }
  return sockets;
}

/** `ps -A -o pid=,ppid=,args=`: two numbers then the command line. */
export function parseProcessTable(stdout: string): ReadonlyArray<ProcessRecord> {
  const records: Array<ProcessRecord> = [];
  for (const rawLine of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s*(.*)$/.exec(rawLine);
    if (match === null) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const ppid = Number.parseInt(match[2]!, 10);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const command = match[3]!.trim();
    records.push({
      pid,
      ppid,
      command: command.length === 0 ? null : command.slice(0, AGENT_PORTS_COMMAND_MAX_LENGTH),
    });
  }
  return records;
}

/** `lsof -a -p … -d cwd -F pn`: `p<pid>` then `n<path>`. */
export function parseLsofCwds(stdout: string): ReadonlyMap<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length < 2) continue;
    if (line[0] === "p") {
      const parsed = Number.parseInt(line.slice(1), 10);
      pid = Number.isInteger(parsed) ? parsed : null;
      continue;
    }
    if (line[0] === "n" && pid !== null && !cwds.has(pid)) {
      const path = line.slice(1).trim();
      if (path.length > 0) cwds.set(pid, path);
    }
  }
  return cwds;
}

export function isDescendantOf(
  pid: number,
  ancestorPid: number,
  parentByPid: ReadonlyMap<number, number>,
): boolean {
  const visited = new Set<number>();
  let current = parentByPid.get(pid);
  while (current !== undefined && current > 0 && !visited.has(current)) {
    if (current === ancestorPid) return true;
    visited.add(current);
    current = parentByPid.get(current);
  }
  return false;
}

function stripTrailingSeparators(path: string): string {
  let end = path.length;
  while (end > 1 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  return path.slice(0, end);
}

export function isInsideRoot(cwd: string, root: string): boolean {
  const normalizedRoot = stripTrailingSeparators(root);
  if (normalizedRoot.length === 0) return false;
  const normalizedCwd = stripTrailingSeparators(cwd);
  if (normalizedCwd === normalizedRoot) return true;
  return (
    normalizedCwd.startsWith(normalizedRoot) &&
    (normalizedCwd[normalizedRoot.length] === "/" || normalizedCwd[normalizedRoot.length] === "\\")
  );
}

export function resolveAgentPortOrigin(input: {
  readonly socket: ListeningSocket;
  readonly serverPid: number;
  readonly parentByPid: ReadonlyMap<number, number>;
  readonly cwd: string | null;
  readonly cwdRoots: ReadonlyArray<string>;
}): AgentPortOrigin | null {
  if (input.socket.pid === input.serverPid) return null;
  if (isDescendantOf(input.socket.pid, input.serverPid, input.parentByPid)) {
    return "agent-process";
  }
  if (input.cwd !== null && input.cwdRoots.some((root) => isInsideRoot(input.cwd!, root))) {
    return "workspace";
  }
  return null;
}

export const make = Effect.gen(function* () {
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcessPlatform;
  const serverPid = yield* AgentPortsServerPid;

  const runProbe = (label: string, command: string, args: ReadonlyArray<string>) =>
    processRunner
      .run({
        command,
        args,
        timeout: PROBE_TIMEOUT,
        maxOutputBytes: PROBE_MAX_OUTPUT_BYTES,
        outputMode: "truncate",
      })
      .pipe(
        Effect.map((result) => result.stdout),
        Effect.catch((error) =>
          Effect.logDebug("agent ports probe failed", { probe: label, cause: error }).pipe(
            Effect.as<string | null>(null),
          ),
        ),
      );

  const list = Effect.fn("AgentPortsService.list")(function* (input: AgentPortsListInput) {
    const scannedAt = DateTime.formatIso(yield* DateTime.now);
    if (platform === "win32") {
      return { ports: [], scannedAt, supported: false } satisfies AgentPortsList;
    }
    const lsofStdout = yield* runProbe("lsof", "lsof", [
      "-iTCP",
      "-sTCP:LISTEN",
      "-P",
      "-n",
      "-F",
      "pcn",
    ]);
    if (lsofStdout === null) {
      return { ports: [], scannedAt, supported: false } satisfies AgentPortsList;
    }
    const sockets = parseLsofListeners(lsofStdout);
    if (sockets.length === 0) {
      return { ports: [], scannedAt, supported: true } satisfies AgentPortsList;
    }

    const psStdout = yield* runProbe("ps", "ps", ["-A", "-o", "pid=,ppid=,args="]);
    const processes = psStdout === null ? [] : parseProcessTable(psStdout);
    const parentByPid = new Map(processes.map((record) => [record.pid, record.ppid] as const));
    const commandByPid = new Map(processes.map((record) => [record.pid, record.command] as const));

    const listenerPids = [...new Set(sockets.map((socket) => socket.pid))].filter(
      (pid) => pid !== serverPid,
    );
    const cwdStdout =
      listenerPids.length === 0
        ? null
        : yield* runProbe("lsof-cwd", "lsof", [
            "-a",
            "-p",
            listenerPids.join(","),
            "-d",
            "cwd",
            "-F",
            "pn",
          ]);
    const cwdByPid = cwdStdout === null ? new Map<number, string>() : parseLsofCwds(cwdStdout);

    const ports: Array<AgentPort> = [];
    for (const socket of sockets) {
      const cwd = cwdByPid.get(socket.pid) ?? null;
      const origin = resolveAgentPortOrigin({
        socket,
        serverPid,
        parentByPid,
        cwd,
        cwdRoots: input.cwdRoots,
      });
      if (origin === null) continue;
      ports.push({
        port: socket.port,
        host: socket.host,
        pid: socket.pid,
        processName: socket.processName,
        command: commandByPid.get(socket.pid) ?? null,
        cwd,
        origin,
      });
    }
    ports.sort((a, b) => a.port - b.port || a.pid - b.pid);
    return { ports, scannedAt, supported: true } satisfies AgentPortsList;
  });

  return AgentPortsService.of({ list });
});

export const layer = Layer.effect(AgentPortsService, make);

/** Nothing listening, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  AgentPortsService,
  AgentPortsService.of({
    list: () =>
      Effect.succeed({ ports: [], scannedAt: "1970-01-01T00:00:00.000Z", supported: true }),
  }),
);
