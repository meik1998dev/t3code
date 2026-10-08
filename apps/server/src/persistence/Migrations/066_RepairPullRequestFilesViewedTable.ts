import * as Effect from "effect/Effect";

import PullRequestFilesViewed from "./053_PullRequestFilesViewed.ts";

// Fork databases already carried a migration 53 of their own, so the runner treated upstream's
// 53 (PullRequestFilesViewed) as applied and skipped it, leaving the viewed-files table missing.
// Upstream's migration only creates a table if it is absent, so replaying it here is safe on both
// fresh databases and ones that already ran it.
export default Effect.gen(function* () {
  yield* PullRequestFilesViewed;
});
