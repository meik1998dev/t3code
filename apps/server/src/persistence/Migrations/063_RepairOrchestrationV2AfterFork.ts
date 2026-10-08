import * as Effect from "effect/Effect";
import * as Migrator from "effect/unstable/sql/Migrator";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import OrchestrationV2 from "./055_OrchestrationV2.ts";
import RemoveRedundantProjectionIndexes from "./056_RemoveRedundantProjectionIndexes.ts";

// Spindle databases had recorded fork migrations at 55-60 before upstream
// shipped OrchestrationV2 (55) and RemoveRedundantProjectionIndexes (56). The
// runner only runs ids above the latest recorded one, so those databases skip
// both. Upstream 55 is not idempotent, so it runs here only when its tables
// are missing. Fresh databases already ran it and this does nothing but the
// index drops, which are idempotent.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const v2Tables = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_events'
  `;
  if (v2Tables.length === 0) {
    const eventColumns = yield* sql<{ readonly name: string }>`
      PRAGMA table_info(orchestration_events)
    `;
    if (eventColumns.some((column) => column.name === "application_event_version")) {
      return yield* new Migrator.MigrationError({
        kind: "BadState",
        message: "OrchestrationV2 was partly applied; cannot repair it automatically.",
      });
    }
    yield* OrchestrationV2;
  }
  yield* RemoveRedundantProjectionIndexes;
  // Record upstream's names at 55 and 56 so the ledger matches a fresh database.
  yield* sql`
    UPDATE effect_sql_migrations SET name = 'OrchestrationV2'
    WHERE migration_id = 55 AND name = 'RepairUpstreamMigrationsAfterFork'
  `;
  yield* sql`
    UPDATE effect_sql_migrations SET name = 'RemoveRedundantProjectionIndexes'
    WHERE migration_id = 56 AND name = 'RepairThreadTitleStateColumn'
  `;
});
