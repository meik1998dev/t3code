import type { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";

import type { McpCapability } from "./McpInvocationContext.ts";

export interface McpProviderSessionConfig {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  /** What the credential grants, so adapters only describe tools that will work. */
  readonly capabilities: ReadonlyArray<McpCapability>;
  readonly endpoint: string;
  readonly authorizationHeader: string;
  /** Whether the credential grants the preview (browser) toolkit; the pull request toolkit always is. */
  readonly preview: boolean;
}

const sessionsByThread = new Map<ThreadId, McpProviderSessionConfig>();

export function setMcpProviderSession(config: McpProviderSessionConfig): void {
  sessionsByThread.set(config.threadId, config);
}

export function readMcpProviderSession(threadId: ThreadId): McpProviderSessionConfig | undefined {
  return sessionsByThread.get(threadId);
}

/** Whether the thread's current MCP credential grants `capability`. */
export function mcpProviderSessionGrants(threadId: ThreadId, capability: McpCapability): boolean {
  return sessionsByThread.get(threadId)?.capabilities.includes(capability) === true;
}

export function clearMcpProviderSession(threadId: ThreadId): void {
  sessionsByThread.delete(threadId);
}

export function clearAllMcpProviderSessions(): void {
  sessionsByThread.clear();
}
