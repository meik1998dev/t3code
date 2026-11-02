import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import repairUpstreamMigrations from "./Migrations/078_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./Migrations/079_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./Migrations/080_RepairOrchestrationV2AfterFork.ts";
import parentThreadId from "./Migrations/081_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./Migrations/082_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./Migrations/083_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./Migrations/084_RepairThreadAutoSettleColumn.ts";
import repairUpstream57To60 from "./Migrations/085_RepairUpstream57To60AfterFork.ts";

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
    Array.from({ length: FORK_MIGRATIONS.length }, (_, index) => 78 + index),
    `fork rows recorded at ${forkFirstId} were not moved onto 78-85`,
  );
  assert.deepStrictEqual(yield* runMigrations(), []);
});

const schemaNames = Effect.fn(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly name: string }>`
    SELECT name FROM sqlite_master WHERE name IN (
      'pull_request_review_guides',
      'orchestration_v2_projection_turn_items_failed_error_idx',
      'scheduled_task_webhook_replay_keys',
      'orchestration_v2_projection_turn_items_stop_request_idx',
      'orchestration_v2_message_search',
      'peer_environment_links',
      'orchestration_v2_projection_turn_items_waiting_link_idx',
      'orchestration_v2_projection_turn_items_active_ordinal_idx',
      'orchestration_v2_projection_subagents_settled_idx'
    )
  `;
  return rows.map((row) => row.name).sort();
});

const EXPECTED_SCHEMA_NAMES = [
  "orchestration_v2_message_search",
  "orchestration_v2_projection_subagents_settled_idx",
  "orchestration_v2_projection_turn_items_active_ordinal_idx",
  "orchestration_v2_projection_turn_items_failed_error_idx",
  "orchestration_v2_projection_turn_items_stop_request_idx",
  "orchestration_v2_projection_turn_items_waiting_link_idx",
  "peer_environment_links",
  "pull_request_review_guides",
  "scheduled_task_webhook_replay_keys",
];

// Each generation gets its own database: an in-memory SQLite layer is one
// database for the whole block, so a second case would start already migrated.
const freshDatabase = <A, E>(name: string, body: () => Effect.Effect<A, E, SqlClient.SqlClient>) =>
  it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(name, (it) => {
    it.effect(name, body);
  });

freshDatabase("moves fork rows 61-68 to 78-85 and applies upstream 61-77", () =>
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
      Array.from({ length: 17 }, (_, index) => 61 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(61);
  }),
);

freshDatabase("moves fork rows 63-70 to 78-85 and applies upstream 63-77", () =>
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
      Array.from({ length: 15 }, (_, index) => 63 + index),
    );
    yield* assertNormalized(63);
  }),
);

freshDatabase("moves fork rows 68-75 to 78-85 and applies upstream 68-77", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A fork database as the v0.1.1 ledger fix left it: upstream 1-67 are
    // recorded, and the fork block sits on 68-75.
    yield* runMigrations({ toMigrationInclusive: 67 });
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(68)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      Array.from({ length: 10 }, (_, index) => 68 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(68);
  }),
);

freshDatabase("moves fork rows 70-77 to 78-85 and applies upstream 70-77", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A fork database as the v0.1.3 sync left it: upstream 1-69 are recorded,
    // and the fork block sits on 70-77.
    yield* runMigrations({ toMigrationInclusive: 69 });
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(70)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      Array.from({ length: 8 }, (_, index) => 70 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(70);
  }),
);
