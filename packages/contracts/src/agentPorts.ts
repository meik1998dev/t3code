/**
 * Agent ports: TCP listeners that an agent session opened on an environment
 * (dev servers, preview builds, test databases started from a thread).
 *
 * The server keeps a listener when its process descends from the Spindle
 * server (agents and their shells are children of it) or when its working
 * directory lives under a project workspace or thread worktree. The second
 * rule catches servers that were detached (`nohup … &`) and reparented away
 * from the agent. Everything else on the machine is left out on purpose.
 */
import * as Schema from "effect/Schema";
import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const AGENT_PORTS_CWD_ROOTS_MAX_ITEMS = 500;
export const AGENT_PORTS_COMMAND_MAX_LENGTH = 1000;

export const AgentPortsListInput = Schema.Struct({
  /**
   * Absolute directories owned by the client's projects and threads. A listener
   * whose cwd is one of them (or inside one) counts as agent-started.
   */
  cwdRoots: Schema.Array(TrimmedNonEmptyString).check(
    Schema.isMaxLength(AGENT_PORTS_CWD_ROOTS_MAX_ITEMS),
  ),
});
export type AgentPortsListInput = typeof AgentPortsListInput.Type;

export const AgentPortOrigin = Schema.Literals(["agent-process", "workspace"]);
export type AgentPortOrigin = typeof AgentPortOrigin.Type;

export const AgentPort = Schema.Struct({
  port: Schema.Int.check(Schema.isGreaterThan(0)).check(Schema.isLessThan(65536)),
  /** Bind address as lsof prints it: `127.0.0.1`, `*`, `::1`, `[::]`. */
  host: TrimmedNonEmptyString,
  pid: Schema.Int.check(Schema.isGreaterThan(0)),
  /** Short executable name from lsof, e.g. `node`. */
  processName: Schema.NullOr(TrimmedNonEmptyString),
  /** Full command line from `ps`, cut to AGENT_PORTS_COMMAND_MAX_LENGTH. */
  command: Schema.NullOr(TrimmedNonEmptyString),
  cwd: Schema.NullOr(TrimmedNonEmptyString),
  /** Why the listener is in the list. */
  origin: AgentPortOrigin,
});
export type AgentPort = typeof AgentPort.Type;

export const AgentPortsList = Schema.Struct({
  ports: Schema.Array(AgentPort),
  scannedAt: IsoDateTime,
  /** False on platforms without lsof (Windows); `ports` is empty then. */
  supported: Schema.Boolean,
});
export type AgentPortsList = typeof AgentPortsList.Type;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Whether the listener accepts connections from the local machine only. */
export function isAgentPortLoopbackOnly(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

/** `http://localhost:<port>` for opening the listener from the same machine. */
export function agentPortLocalUrl(port: number): string {
  return `http://localhost:${port}`;
}

/**
 * Command that forwards a remote listener to the same port here. The alias is
 * the SSH host name the user connects with, so the command works unchanged.
 */
export function agentPortTunnelCommand(input: {
  readonly port: number;
  readonly sshHost: string;
}): string {
  return `ssh -N -L ${input.port}:localhost:${input.port} ${input.sshHost}`;
}
