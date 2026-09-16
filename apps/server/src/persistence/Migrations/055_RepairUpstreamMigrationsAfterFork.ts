import * as Effect from "effect/Effect";

import ProjectionThreadPullRequests from "./050_ProjectionThreadPullRequests.ts";
import ProjectionThreadMessageContext from "./051_ProjectionThreadMessageContext.ts";
import ThreadTaskPlanLookup from "./052_ThreadTaskPlanLookup.ts";
import RepairThreadBranchPullRequestColumn from "./053_RepairThreadBranchPullRequestColumn.ts";

// Fork databases recorded different migrations under upstream's numbers, and
// the runner only runs ids above the latest recorded one. Re-run every
// migration involved in the clash; each operation is intentionally idempotent.
export default Effect.gen(function* () {
  yield* ProjectionThreadPullRequests;
  yield* ProjectionThreadMessageContext;
  yield* ThreadTaskPlanLookup;
  yield* RepairThreadBranchPullRequestColumn;
});
