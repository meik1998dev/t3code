import {
  OrchestratorMcpFailure,
  type OrchestrationV2Actor,
  type OrchestrationV2AppThreadLineage,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Spindle keeps agent-started work one level deep: only threads a person
 * started (or imported history) may start or delegate more threads. Threads
 * an agent launched and delegated children can still read, rename and link
 * pull requests through the same tools.
 */
interface ThreadOrigin {
  readonly createdBy?: OrchestrationV2Actor | undefined;
  readonly lineage?: Pick<OrchestrationV2AppThreadLineage, "relationshipToParent"> | undefined;
}

export const mayStartThreads = (thread: ThreadOrigin) =>
  thread.createdBy !== "agent" && thread.lineage?.relationshipToParent !== "subagent";

export const assertMayStartThreads = (thread: ThreadOrigin) =>
  mayStartThreads(thread)
    ? Effect.void
    : Effect.fail(
        new OrchestratorMcpFailure({
          code: "capability_denied",
          message:
            "This thread was started by an agent, so it cannot start or delegate more threads. Finish the work here, or ask the person to start another thread.",
        }),
      );
