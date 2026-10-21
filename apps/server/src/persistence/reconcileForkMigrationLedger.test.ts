import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import repairUpstreamMigrations from "./Migrations/068_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./Migrations/069_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./Migrations/070_RepairOrchestrationV2AfterFork.ts";
import parentThreadId from "./Migrations/071_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./Migrations/072_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./Migrations/073_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./Migrations/074_RepairThreadAutoSettleColumn.ts";
import repairUpstream57To60 from "./Migrations/075_RepairUpstream57To60AfterFork.ts";

const FORK_MIGRATIONS = [
  ["RepairUpstreamMigrationsAfterFork", repairUpstreamMigrations],
  ["RepairThreadTitleStateColumn", repairThreadTitleState],
  ["RepairOrchestrationV2AfterFork", repairOrchestrationV2],
  ["ProjectionThreadsParentThreadId", parentThreadId],
  ["RepairThreadBranchPullRequestColumn", repairBranchPullRequest],
  ["RepairPullRequestFilesViewedTable", repairFilesViewed],
  ["RepairThreadAutoSettleColumn", repairAutoSettle],
  ["RepairUpstream57To60AfterFork", repairUpstream57To60],
] as const;

// A fork database records the fork block at whatever ids that generation used,
// so each generation is built the way its own build left it.
const forkLedger = (firstId: number) =>
  FORK_MIGRATIONS.map(([name], index) => [firstId + index, name] as const);

const assertNormalized = Effect.fn(function* (forkFirstId: number) {
  const sql = yield* SqlClient.SqlClient;
  const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `;
  assert.deepStrictEqual(
    ledger.map((row) => [row.migration_id, row.name]),
    migrationManifest.map(([id, name]) => [id, name]),
  );
  const forkRows = ledger.filter((row) => FORK_MIGRATIONS.some(([name]) => name === row.name));
  assert.deepStrictEqual(
    forkRows.map((row) => row.migration_id),
    Array.from({ length: FORK_MIGRATIONS.length }, (_, index) => 68 + index),
    `fork rows recorded at ${forkFirstId} were not moved onto 68-75`,
  );
  assert.deepStrictEqual(yield* runMigrations(), []);
});

const schemaNames = Effect.fn(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE name IN (
      'pull_request_review_guides',
      'orchestration_v2_projection_turn_items_failed_error_idx',
      'scheduled_task_webhook_replay_keys'
    )
  `;
  return rows.map((row) => row.name).sort();
});

// Each generation gets its own database: an in-memory SQLite layer is one
// database for the whole block, so a second case would start already migrated.
const freshDatabase = <A, E>(name: string, body: () => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(name, (it) => {
    it.effect(name, body);
  });

freshDatabase("moves fork rows 61-68 to 68-75 and applies upstream 61-67", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 60 });
    // A fork database as the v0.0.46 sync left it.
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(61)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      [61, 62, 63, 64, 65, 66, 67],
    );
    assert.deepStrictEqual(yield* schemaNames(), [
      "orchestration_v2_projection_turn_items_failed_error_idx",
      "pull_request_review_guides",
      "scheduled_task_webhook_replay_keys",
    ]);
    yield* assertNormalized(61);
  }),
);

freshDatabase("moves fork rows 63-70 to 68-75 and applies upstream 63-67", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* runMigrations({ toMigrationInclusive: 60 });
    // A fork database as the v0.1.1 sync left it: upstream 61-62 are recorded,
    // and the fork block sits on 63-70.
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(63)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }
    yield* sql`
      INSERT INTO effect_sql_migrations (migration_id, name) VALUES
        (61, 'PullRequestReviewGuides'),
        (62, 'ThreadFailureLookupIndex')
    `;

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      [63, 64, 65, 66, 67],
    );
    yield* assertNormalized(63);
  }),
);
