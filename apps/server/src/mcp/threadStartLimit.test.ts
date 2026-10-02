import { assert, describe, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import { assertMayStartThreads, mayStartThreads } from "./threadStartLimit.ts";

const lineage = (relationshipToParent: "fork" | "subagent" | null) => ({ relationshipToParent });

describe("threadStartLimit", () => {
  it("lets person-started, imported and forked threads start more threads", () => {
    assert.isTrue(mayStartThreads({ createdBy: "user", lineage: lineage(null) }));
    assert.isTrue(mayStartThreads({ createdBy: "system", lineage: lineage(null) }));
    assert.isTrue(mayStartThreads({ createdBy: "user", lineage: lineage("fork") }));
  });

  it("keeps agent-started threads and delegated children one level deep", () => {
    assert.isFalse(mayStartThreads({ createdBy: "agent", lineage: lineage(null) }));
    assert.isFalse(mayStartThreads({ createdBy: "user", lineage: lineage("subagent") }));
  });

  it.effect("fails with capability_denied for an agent-started thread", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        assertMayStartThreads({ createdBy: "agent", lineage: lineage(null) }),
      );
      assert.isTrue(Exit.isFailure(exit));
      const failure = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.propertyVal(failure, "code", "capability_denied");
    }),
  );
});
