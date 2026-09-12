/**
 * Pure helpers for the sidebar "Agent ports" popover: which directories to
 * send to each server, and which thread or project a listener belongs to.
 * The server only knows a process's cwd; the client knows the worktrees.
 */
import {
  AGENT_PORTS_CWD_ROOTS_MAX_ITEMS,
  type AgentPort,
  type EnvironmentId,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

export interface AgentPortProjectLike {
  readonly environmentId: EnvironmentId;
  readonly id: ProjectId;
  readonly title: string;
  readonly workspaceRoot: string;
}

export interface AgentPortThreadLike {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly worktreePath: string | null;
  readonly archivedAt: string | null;
}

export type AgentPortOwner =
  | {
      readonly kind: "thread";
      readonly threadId: ThreadId;
      readonly projectId: ProjectId;
      readonly title: string;
      readonly projectTitle: string | null;
    }
  | { readonly kind: "project"; readonly projectId: ProjectId; readonly title: string };

function trimSeparators(path: string): string {
  let end = path.length;
  while (end > 1 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  return path.slice(0, end);
}

export function isPathInside(path: string, root: string): boolean {
  const normalizedRoot = trimSeparators(root);
  if (normalizedRoot.length === 0) return false;
  const normalizedPath = trimSeparators(path);
  if (normalizedPath === normalizedRoot) return true;
  const next = normalizedPath[normalizedRoot.length];
  return normalizedPath.startsWith(normalizedRoot) && (next === "/" || next === "\\");
}

/**
 * Directories the server should treat as agent-owned: every project root and
 * every live thread worktree of that environment. Sorted and deduplicated so
 * the query key stays stable between renders.
 */
export function collectAgentPortCwdRoots(input: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<AgentPortProjectLike>;
  readonly threads: ReadonlyArray<AgentPortThreadLike>;
}): ReadonlyArray<string> {
  const roots = new Set<string>();
  for (const project of input.projects) {
    if (project.environmentId !== input.environmentId) continue;
    const root = trimSeparators(project.workspaceRoot.trim());
    if (root.length > 0) roots.add(root);
  }
  for (const thread of input.threads) {
    if (thread.environmentId !== input.environmentId || thread.archivedAt !== null) continue;
    if (thread.worktreePath === null) continue;
    const root = trimSeparators(thread.worktreePath.trim());
    if (root.length > 0) roots.add(root);
  }
  return [...roots].sort().slice(0, AGENT_PORTS_CWD_ROOTS_MAX_ITEMS);
}

/**
 * The deepest thread worktree containing the listener's cwd wins; a project
 * root is the fallback. Archived threads still count so a server left running
 * after archiving is not shown as an anonymous project process.
 */
export function resolveAgentPortOwner(input: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string | null;
  readonly projects: ReadonlyArray<AgentPortProjectLike>;
  readonly threads: ReadonlyArray<AgentPortThreadLike>;
}): AgentPortOwner | null {
  if (input.cwd === null) return null;
  const projectsById = new Map(
    input.projects
      .filter((project) => project.environmentId === input.environmentId)
      .map((project) => [project.id, project] as const),
  );
  let bestThread: AgentPortThreadLike | null = null;
  for (const thread of input.threads) {
    if (thread.environmentId !== input.environmentId || thread.worktreePath === null) continue;
    if (!isPathInside(input.cwd, thread.worktreePath)) continue;
    if (bestThread === null || thread.worktreePath.length > bestThread.worktreePath!.length) {
      bestThread = thread;
    }
  }
  if (bestThread !== null) {
    return {
      kind: "thread",
      threadId: bestThread.id,
      projectId: bestThread.projectId,
      title: bestThread.title,
      projectTitle: projectsById.get(bestThread.projectId)?.title ?? null,
    };
  }
  let bestProject: AgentPortProjectLike | null = null;
  for (const project of projectsById.values()) {
    if (!isPathInside(input.cwd, project.workspaceRoot)) continue;
    if (bestProject === null || project.workspaceRoot.length > bestProject.workspaceRoot.length) {
      bestProject = project;
    }
  }
  return bestProject === null
    ? null
    : { kind: "project", projectId: bestProject.id, title: bestProject.title };
}

const COMMAND_DISPLAY_MAX_LENGTH = 72;

/**
 * `/usr/local/bin/node /repo/node_modules/.bin/vite --port 5173` →
 * `node vite --port 5173`. Interpreter paths and script paths are noise in a
 * one-line row; the flags are what tell servers apart.
 */
export function formatAgentPortCommand(port: Pick<AgentPort, "command" | "processName">): string {
  const command = port.command?.trim() ?? "";
  if (command.length === 0) return port.processName ?? "unknown process";
  const parts = command.split(/\s+/).map((part, index) => {
    if (index > 1 && part.startsWith("-")) return part;
    if (!part.includes("/") && !part.includes("\\")) return part;
    const base = part.split(/[\\/]/).at(-1) ?? part;
    return base.length > 0 ? base : part;
  });
  const text = parts.join(" ");
  return text.length > COMMAND_DISPLAY_MAX_LENGTH
    ? `${text.slice(0, COMMAND_DISPLAY_MAX_LENGTH - 1)}…`
    : text;
}

/** Last path segment, for a cwd with no known thread or project. */
export function formatAgentPortCwd(cwd: string | null): string | null {
  if (cwd === null) return null;
  const trimmed = trimSeparators(cwd);
  return trimmed.split(/[\\/]/).at(-1) || trimmed;
}
