import {
  agentPortLocalUrl,
  agentPortTunnelCommand,
  EnvironmentId,
  isAgentPortLoopbackOnly,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectAgentPortCwdRoots,
  formatAgentPortCommand,
  formatAgentPortCwd,
  resolveAgentPortOwner,
} from "./agentPorts.logic";

const mac = EnvironmentId.make("env-mac");
const vps = EnvironmentId.make("env-vps");

const projects = [
  {
    environmentId: mac,
    id: ProjectId.make("p-app"),
    title: "App",
    workspaceRoot: "/Users/alice/code/app/",
  },
  {
    environmentId: vps,
    id: ProjectId.make("p-api"),
    title: "API",
    workspaceRoot: "/root/repos/api",
  },
];

const threads = [
  {
    environmentId: mac,
    id: ThreadId.make("t-1"),
    projectId: ProjectId.make("p-app"),
    title: "Fix login",
    worktreePath: "/Users/alice/.t3/worktrees/app/abc",
    archivedAt: null,
  },
  {
    environmentId: mac,
    id: ThreadId.make("t-2"),
    projectId: ProjectId.make("p-app"),
    title: "Old work",
    worktreePath: "/Users/alice/.t3/worktrees/app/old",
    archivedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    environmentId: vps,
    id: ThreadId.make("t-3"),
    projectId: ProjectId.make("p-api"),
    title: "Add search",
    worktreePath: null,
    archivedAt: null,
  },
];

describe("collectAgentPortCwdRoots", () => {
  it("sends the environment's project roots and live worktrees, trimmed and sorted", () => {
    expect(collectAgentPortCwdRoots({ environmentId: mac, projects, threads })).toEqual([
      "/Users/alice/.t3/worktrees/app/abc",
      "/Users/alice/code/app",
    ]);
    expect(collectAgentPortCwdRoots({ environmentId: vps, projects, threads })).toEqual([
      "/root/repos/api",
    ]);
  });
});

describe("resolveAgentPortOwner", () => {
  it("prefers the thread worktree over the project root", () => {
    expect(
      resolveAgentPortOwner({
        environmentId: mac,
        cwd: "/Users/alice/.t3/worktrees/app/abc/apps/web",
        projects,
        threads,
      }),
    ).toEqual({
      kind: "thread",
      threadId: "t-1",
      projectId: "p-app",
      title: "Fix login",
      projectTitle: "App",
    });
  });

  it("still names archived threads, so a leftover server is not anonymous", () => {
    expect(
      resolveAgentPortOwner({
        environmentId: mac,
        cwd: "/Users/alice/.t3/worktrees/app/old",
        projects,
        threads,
      }),
    ).toMatchObject({ kind: "thread", title: "Old work" });
  });

  it("falls back to the project and ignores other environments", () => {
    expect(
      resolveAgentPortOwner({
        environmentId: mac,
        cwd: "/Users/alice/code/app",
        projects,
        threads,
      }),
    ).toEqual({ kind: "project", projectId: "p-app", title: "App" });
    expect(
      resolveAgentPortOwner({
        environmentId: vps,
        cwd: "/Users/alice/code/app",
        projects,
        threads,
      }),
    ).toBeNull();
    expect(
      resolveAgentPortOwner({
        environmentId: mac,
        cwd: "/Users/alice/code/app-2",
        projects,
        threads,
      }),
    ).toBeNull();
  });
});

describe("formatting", () => {
  it("drops interpreter and script paths but keeps flags", () => {
    expect(
      formatAgentPortCommand({
        command: "/usr/local/bin/node /repo/node_modules/.bin/vite --port 5173 --host",
        processName: "node",
      }),
    ).toBe("node vite --port 5173 --host");
    expect(formatAgentPortCommand({ command: null, processName: "postgres" })).toBe("postgres");
    expect(formatAgentPortCommand({ command: "   ", processName: null })).toBe("unknown process");
  });

  it("shows the last folder of an unknown cwd", () => {
    expect(formatAgentPortCwd("/tmp/scratch/")).toBe("scratch");
    expect(formatAgentPortCwd(null)).toBeNull();
  });

  it("builds the local URL and the tunnel command", () => {
    expect(agentPortLocalUrl(5173)).toBe("http://localhost:5173");
    expect(agentPortTunnelCommand({ port: 5173, sshHost: "srv.local" })).toBe(
      "ssh -N -L 5173:localhost:5173 srv.local",
    );
    expect(isAgentPortLoopbackOnly("127.0.0.1")).toBe(true);
    expect(isAgentPortLoopbackOnly("*")).toBe(false);
  });
});
