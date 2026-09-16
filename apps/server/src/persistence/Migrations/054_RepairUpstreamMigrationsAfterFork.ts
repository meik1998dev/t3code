import * as Effect from "effect/Effect";

import ProjectionThreadPullRequests from "./050_ProjectionThreadPullRequests.ts";

// Fork databases recorded their own migrations under upstream's numbers, and
// the runner only runs ids above the latest recorded one, so upstream's
// migrations with those numbers never ran there. Re-running them is safe:
// each one only creates what is missing and ignores rows it already copied.
export default Effect.gen(function* () {
  yield* ProjectionThreadPullRequests;
});
