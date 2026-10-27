/**
 * AgentPortsService - lists TCP listeners that agent sessions opened on this
 * environment (dev servers, previews, test databases).
 *
 * Detection is live, no bookkeeping:
 *  1. Listeners with their pid: `ss -ltnpH` on Linux, `lsof -iTCP -sTCP:LISTEN`
 *     elsewhere. lsof 4.95 on Ubuntu skips processes whose name contains
 *     parentheses (`next-server (v16.0.3)`), so Linux uses iproute2.
 *  2. `ps -A -o pid=,ppid=,args=` gives the process tree and command lines.
 *  3. Working directory: `/proc/<pid>/cwd` on Linux, `lsof -a -p <pids> -d cwd`
 *     on macOS.
 *
 * A listener is kept when its process descends from this server process
 * (agents and their shells are children of it) — origin `agent-process` — or
 * when its cwd is inside one of the client's workspace roots, which catches
 * servers that were detached and reparented — origin `workspace`. The server's
 * own listeners and everything else on the machine are dropped.
 *
 * With `scope: "all"` nothing is dropped: the rest of the machine comes back
 * as origin `system` (this server included), so a user can see what already
 * holds a port. `stop` always re-scans in the agent scope, so those rows can
 * be read but never signalled.
 *
 * Windows has no lsof; the list is empty with `supported: false`.
 */
import {
  AGENT_PORTS_COMMAND_MAX_LENGTH,
  type AgentPort,
  type AgentPortOrigin,
  type AgentPortsList,
  type AgentPortsListInput,
  type AgentPortsScope,
  type AgentPortStopInput,
  type AgentPortStopResult,
  type AgentPortsUsage,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as ProcessRunner from "../processRunner.ts";

export class AgentPortsService extends Context.Service<
  AgentPortsService,
  {
    readonly list: (input: AgentPortsListInput) => Effect.Effect<AgentPortsList>;
    /**
     * SIGTERM the listener, SIGKILL if it is still there after the grace
     * period. Re-scans first: the pid must still own that port and still count
     * as an agent port, so a recycled pid or the server itself is never hit.
     */
    readonly stop: (input: AgentPortStopInput) => Effect.Effect<AgentPortStopResult>;
  }
>()("t3/ports/AgentPortsService") {}

/** Pid of the process that owns the agent sessions; tests override it. */
export const AgentPortsServerPid = Context.Reference<number>("t3/ports/AgentPortsServerPid", {
  defaultValue: () => process.pid,
});

export interface AgentPortsProcessControl {
  readonly signal: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  readonly isAlive: (pid: number) => boolean;
}

/** How signals reach a pid; tests record instead of killing. */
export const AgentPortsProcessControl = Context.Reference<AgentPortsProcessControl>(
  "t3/ports/AgentPortsProcessControl",
  {
    defaultValue: () => ({
      signal: (pid, signal) => {
        process.kill(pid, signal);
      },
      isAlive: (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      },
    }),
  },
);

const STOP_GRACE_PERIOD = Duration.seconds(2);

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

const SS_USER_PATTERN = /\("((?:[^"\\]|\\.)*)",pid=(\d+),fd=\d+\)/g;

/**
 * `ss -ltnpH`: `LISTEN 0 511 *:3000 *:* users:(("next-server (v1",pid=105641,fd=22))`.
 * The name inside `users:` is cut by ss at 15 bytes; `ps` supplies the full command.
 */
export function parseSsListeners(stdout: string): ReadonlyArray<ListeningSocket> {
  const sockets: Array<ListeningSocket> = [];
  const seen = new Set<string>();
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const columns = line.split(/\s+/);
    // With -H the state column is absent only on some versions; accept both shapes.
    const localIndex = columns[0] === "LISTEN" ? 3 : 2;
    const local = columns[localIndex];
    if (local === undefined) continue;
    const separator = local.lastIndexOf(":");
    if (separator <= 0) continue;
    const port = Number.parseInt(local.slice(separator + 1), 10);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) continue;
    const host = local.slice(0, separator).trim() || "*";
    for (const match of line.matchAll(SS_USER_PATTERN)) {
      const pid = Number.parseInt(match[2]!, 10);
      if (!Number.isInteger(pid) || pid <= 0) continue;
      const key = `${pid}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sockets.push({ pid, processName: match[1]!.trim() || null, host, port });
    }
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

export interface CpuTicks {
  readonly idle: number;
  readonly total: number;
}

/**
 * `/proc/stat` line 1: `cpu  user nice system idle iowait irq softirq steal …`.
 * `guest`/`guest_nice` are already counted inside `user`/`nice`, so they are
 * left out. Idle time includes `iowait`.
 */
export function parseProcStatCpu(stdout: string): CpuTicks | null {
  const line = stdout.split("\n")[0]?.trim() ?? "";
  if (!line.startsWith("cpu ")) return null;
  const values: Array<number> = [];
  for (const raw of line.split(/\s+/).slice(1)) {
    const value = Number.parseInt(raw, 10);
    if (!Number.isInteger(value) || value < 0) return null;
    values.push(value);
  }
  if (values.length < 5) return null;
  const idle = (values[3] ?? 0) + (values[4] ?? 0);
  const total = values.slice(0, 8).reduce((sum, value) => sum + value, 0);
  return total > 0 ? { idle, total } : null;
}

/** `/proc/meminfo`: used share of RAM, from `MemTotal` and `MemAvailable`. */
export function parseProcMeminfo(stdout: string): number | null {
  const total = /^MemTotal:\s+(\d+)\s+kB$/m.exec(stdout)?.[1];
  const available = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(stdout)?.[1];
  if (total === undefined || available === undefined) return null;
  const totalKb = Number(total);
  const availableKb = Number(available);
  if (!Number.isFinite(totalKb) || totalKb <= 0 || !Number.isFinite(availableKb)) return null;
  return clampPercent((1 - Math.min(availableKb, totalKb) / totalKb) * 100);
}

/** `df -P -k /`: the Capacity column (`63%`) of the root filesystem. */
export function parseDfCapacity(stdout: string): number | null {
  const lines = stdout.split("\n").filter((line) => line.trim().length > 0);
  const capacity = lines[1]?.trim().split(/\s+/)[4];
  if (capacity === undefined || !capacity.endsWith("%")) return null;
  const percent = Number.parseInt(capacity, 10);
  return Number.isInteger(percent) && percent >= 0 && percent <= 100 ? percent : null;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
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
  const fileSystem = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const serverPid = yield* AgentPortsServerPid;
  const processControl = yield* AgentPortsProcessControl;

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

  // Suspended so the probe command is only built (and, in tests, recorded) when it runs.
  const lsofListeners = Effect.suspend(() =>
    runProbe("lsof", "lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-F", "pcn"]),
  ).pipe(Effect.map((stdout) => (stdout === null ? null : parseLsofListeners(stdout))));

  const ssListeners = Effect.suspend(() => runProbe("ss", "ss", ["-ltnpH"])).pipe(
    Effect.map((stdout) => (stdout === null ? null : parseSsListeners(stdout))),
    // Old images without iproute2 still have lsof.
    Effect.filterOrElse(
      (sockets) => sockets !== null,
      () => lsofListeners,
    ),
  );

  const probeListeners = platform === "linux" ? ssListeners : lsofListeners;

  const procCwds = (pids: ReadonlyArray<number>) =>
    Effect.forEach(
      pids,
      (pid) =>
        fileSystem.readLink(`/proc/${pid}/cwd`).pipe(
          Effect.map((cwd) => [pid, cwd] as const),
          Effect.orElseSucceed(() => null),
        ),
      { concurrency: 8 },
    ).pipe(
      Effect.map(
        (entries) =>
          new Map(entries.filter((entry): entry is readonly [number, string] => entry !== null)),
      ),
    );

  const lsofCwds = (pids: ReadonlyArray<number>) =>
    runProbe("lsof-cwd", "lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-F", "pn"]).pipe(
      Effect.map((stdout) => (stdout === null ? new Map<number, string>() : parseLsofCwds(stdout))),
    );

  const probeCwds = platform === "linux" ? procCwds : lsofCwds;

  // CPU is a delta, so the previous scan is kept in memory. It is one service
  // per server, which is one environment, so the numbers never cross machines.
  let lastCpuSample: CpuTicks | null = null;
  let lastCpuPercent: number | null = null;

  const readHostUsage = Effect.fn("AgentPortsService.readHostUsage")(function* () {
    if (platform !== "linux") return null;
    const stat = yield* fileSystem
      .readFileString("/proc/stat")
      .pipe(Effect.orElseSucceed(() => ""));
    const meminfo = yield* fileSystem
      .readFileString("/proc/meminfo")
      .pipe(Effect.orElseSucceed(() => ""));
    // `-P` forces one line per filesystem, so a long device name cannot push
    // the Capacity column apart. Linux only, like the rest of this branch.
    const dfStdout = yield* runProbe("df", "df", ["-P", "-k", "/"]);

    const cpu = parseProcStatCpu(stat);
    let cpuPercent = lastCpuPercent;
    if (cpu !== null) {
      if (lastCpuSample !== null && cpu.total > lastCpuSample.total) {
        const totalDelta = cpu.total - lastCpuSample.total;
        const idleDelta = Math.max(0, cpu.idle - lastCpuSample.idle);
        cpuPercent = clampPercent((1 - idleDelta / totalDelta) * 100);
        lastCpuPercent = cpuPercent;
      }
      lastCpuSample = cpu;
    }
    const memoryPercent = parseProcMeminfo(meminfo);
    const diskPercent = dfStdout === null ? null : parseDfCapacity(dfStdout);
    if (cpuPercent === null && memoryPercent === null && diskPercent === null) return null;
    return { cpuPercent, memoryPercent, diskPercent } satisfies AgentPortsUsage;
  });

  const list = Effect.fn("AgentPortsService.list")(function* (input: AgentPortsListInput) {
    const scannedAt = DateTime.formatIso(yield* DateTime.now);
    const scope: AgentPortsScope = input.scope ?? "agent";
    const usage = yield* readHostUsage();
    const usageField = usage === null ? {} : { usage };
    if (platform === "win32") {
      return {
        ports: [],
        scannedAt,
        scope,
        supported: false,
        ...usageField,
      } satisfies AgentPortsList;
    }
    const sockets = yield* probeListeners;
    if (sockets === null) {
      return {
        ports: [],
        scannedAt,
        scope,
        supported: false,
        ...usageField,
      } satisfies AgentPortsList;
    }
    if (sockets.length === 0) {
      return {
        ports: [],
        scannedAt,
        scope,
        supported: true,
        ...usageField,
      } satisfies AgentPortsList;
    }

    const psStdout = yield* runProbe("ps", "ps", ["-A", "-o", "pid=,ppid=,args="]);
    const processes = psStdout === null ? [] : parseProcessTable(psStdout);
    const parentByPid = new Map(processes.map((record) => [record.pid, record.ppid] as const));
    const commandByPid = new Map(processes.map((record) => [record.pid, record.command] as const));

    const listenerPids = [...new Set(sockets.map((socket) => socket.pid))].filter(
      (pid) => pid !== serverPid,
    );
    const cwdByPid =
      listenerPids.length === 0 ? new Map<number, string>() : yield* probeCwds(listenerPids);

    const ports: Array<AgentPort> = [];
    for (const socket of sockets) {
      const cwd = cwdByPid.get(socket.pid) ?? null;
      const agentOrigin = resolveAgentPortOrigin({
        socket,
        serverPid,
        parentByPid,
        cwd,
        cwdRoots: input.cwdRoots,
      });
      if (agentOrigin === null && scope !== "all") continue;
      const origin = agentOrigin ?? "system";
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
    return { ports, scannedAt, scope, supported: true, ...usageField } satisfies AgentPortsList;
  });

  const stop = Effect.fn("AgentPortsService.stop")(function* (input: AgentPortStopInput) {
    // Agent scope on purpose: a `system` listener is never a stop target.
    const current = yield* list({ cwdRoots: input.cwdRoots, scope: "agent" });
    const target = current.ports.find((port) => port.pid === input.pid && port.port === input.port);
    if (target === undefined || target.pid === serverPid) {
      return { stopped: false } satisfies AgentPortStopResult;
    }
    const signalled = yield* Effect.try(() => processControl.signal(target.pid, "SIGTERM")).pipe(
      Effect.as(true),
      Effect.catch((cause) =>
        Effect.logDebug("agent port SIGTERM failed", { pid: target.pid, cause }).pipe(
          Effect.as(false),
        ),
      ),
    );
    if (!signalled) {
      return { stopped: false } satisfies AgentPortStopResult;
    }
    yield* Effect.sleep(STOP_GRACE_PERIOD);
    if (processControl.isAlive(target.pid)) {
      yield* Effect.try(() => processControl.signal(target.pid, "SIGKILL")).pipe(Effect.ignore);
    }
    return { stopped: true } satisfies AgentPortStopResult;
  });

  return AgentPortsService.of({ list, stop });
});

export const layer = Layer.effect(AgentPortsService, make);

/** Nothing listening, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  AgentPortsService,
  AgentPortsService.of({
    list: Effect.fn("AgentPortsService.list")(() =>
      Effect.succeed({
        ports: [],
        scannedAt: "1970-01-01T00:00:00.000Z",
        scope: "agent" as const,
        supported: true,
      }),
    ),
    stop: Effect.fn("AgentPortsService.stop")(() => Effect.succeed({ stopped: false })),
  }),
);
