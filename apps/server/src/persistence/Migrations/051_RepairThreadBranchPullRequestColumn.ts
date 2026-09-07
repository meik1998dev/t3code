import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Fork databases already carried a migration 48 of their own, so the runner
// treated upstream's 48 (ProjectionThreadBranchPullRequest) as applied and
// skipped it, leaving projection_threads without branch_pull_request_json.
// Fresh databases run upstream's 48 normally and this repair does nothing.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "branch_pull_request_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN branch_pull_request_json TEXT
    `;
  }
});
