import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import PullRequestReviewGuides from "./Migrations/061_PullRequestReviewGuides.ts";
import ThreadFailureLookupIndex from "./Migrations/062_ThreadFailureLookupIndex.ts";

// Spindle fork migrations recorded at 61-68 before upstream shipped its own 61
// and 62. They now live at 63-70. A fork database would skip upstream's 61-62
// and fail the V2 id check, so before migrating: apply upstream's 61-62 safely,
// then move the fork rows up by two. The ledger then matches a fresh database
// and none of the fork migrations run again. See FORK.md "Migrations".
const FORK_ROWS = [
  [68, "RepairUpstream57To60AfterFork"],
  [67, "RepairThreadAutoSettleColumn"],
  [66, "RepairPullRequestFilesViewedTable"],
  [65, "RepairThreadBranchPullRequestColumn"],
  [64, "ProjectionThreadsParentThreadId"],
  [63, "RepairOrchestrationV2AfterFork"],
  [62, "RepairThreadTitleStateColumn"],
  [61, "RepairUpstreamMigrationsAfterFork"],
] as const;
const ID_SHIFT = 2;

export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
        if (tables.length === 0) return [];
        const marker = yield* sql`
          SELECT 1 FROM effect_sql_migrations
          WHERE migration_id = 61 AND name = 'RepairUpstreamMigrationsAfterFork'
        `;
        if (marker.length === 0) return [];

        // 61 creates its table only when missing. 62 has no IF NOT EXISTS.
        yield* PullRequestReviewGuides;
        const index = yield* sql`
          SELECT 1 FROM sqlite_master
          WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_failed_error_idx'
        `;
        if (index.length === 0) yield* ThreadFailureLookupIndex;

        // Highest id first so each move lands on a free id.
        for (const [id, name] of FORK_ROWS) {
          yield* sql`
            UPDATE effect_sql_migrations SET migration_id = ${id + ID_SHIFT}
            WHERE migration_id = ${id} AND name = ${name}
          `;
        }
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (61, 'PullRequestReviewGuides'), (62, 'ThreadFailureLookupIndex')
        `;
        return [
          [61, "PullRequestReviewGuides"],
          [62, "ThreadFailureLookupIndex"],
        ] as const;
      }),
    );
  },
);
