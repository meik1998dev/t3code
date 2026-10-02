import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

// Fork databases already carried a migration 52 of their own, so the runner
// treated upstream's 52 (ProjectionThreadTitleState) as applied and skipped it,
// leaving projection_threads without title_state_json.
// Fresh databases run upstream's 52 normally and this repair does nothing.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "title_state_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_state_json TEXT
    `;
  }
});
