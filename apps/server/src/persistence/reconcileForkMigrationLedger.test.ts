import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import repairUpstreamMigrations from "./Migrations/063_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./Migrations/064_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./Migrations/065_RepairOrchestrationV2AfterFork.ts";
import parentThreadId from "./Migrations/066_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./Migrations/067_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./Migrations/068_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./Migrations/069_RepairThreadAutoSettleColumn.ts";
import repairUpstream57To60 from "./Migrations/070_RepairUpstream57To60AfterFork.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("reconcileForkMigrationLedger", (it) => {
  it.effect("moves fork rows 61-68 to 63-70 and applies upstream 61-62", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      // A fork database as the v0.0.46 sync left it.
      yield* repairUpstreamMigrations;
      yield* repairThreadTitleState;
      yield* repairOrchestrationV2;
      yield* parentThreadId;
      yield* repairBranchPullRequest;
      yield* repairFilesViewed;
      yield* repairAutoSettle;
      yield* repairUpstream57To60;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES
          (61, 'RepairUpstreamMigrationsAfterFork'),
          (62, 'RepairThreadTitleStateColumn'),
          (63, 'RepairOrchestrationV2AfterFork'),
          (64, 'ProjectionThreadsParentThreadId'),
          (65, 'RepairThreadBranchPullRequestColumn'),
          (66, 'RepairPullRequestFilesViewedTable'),
          (67, 'RepairThreadAutoSettleColumn'),
          (68, 'RepairUpstream57To60AfterFork')
      `;

      const ran = yield* runMigrations();
      assert.deepStrictEqual(
        ran.map(([id]) => id),
        [61, 62],
      );
      const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
        SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
      `;
      assert.deepStrictEqual(
        ledger.map((row) => [row.migration_id, row.name]),
        migrationManifest.map(([id, name]) => [id, name]),
      );
      const schema = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE name IN (
          'pull_request_review_guides',
          'orchestration_v2_projection_turn_items_failed_error_idx'
        )
      `;
      assert.lengthOf(schema, 2);
      assert.deepStrictEqual(yield* runMigrations(), []);
    }),
  );
});
