import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { migrationManifest, runMigrations } from "./Migrations.ts";
import repairUpstreamMigrations from "./Migrations/103_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./Migrations/104_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./Migrations/105_RepairOrchestrationV2AfterFork.ts";
import parentThreadId from "./Migrations/106_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./Migrations/107_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./Migrations/108_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./Migrations/109_RepairThreadAutoSettleColumn.ts";
import repairUpstream57To60 from "./Migrations/110_RepairUpstream57To60AfterFork.ts";

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
    Array.from({ length: FORK_MIGRATIONS.length }, (_, index) => 103 + index),
    `fork rows recorded at ${forkFirstId} were not moved onto 103-110`,
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
      'orchestration_v2_projection_subagents_settled_idx',
      'orchestration_v2_projection_threads_subagent_result_idx'
    )
  `;
  return rows.map((row) => row.name).sort();
});

const EXPECTED_SCHEMA_NAMES = [
  "orchestration_v2_message_search",
  "orchestration_v2_projection_subagents_settled_idx",
  "orchestration_v2_projection_threads_subagent_result_idx",
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

freshDatabase("moves fork rows 61-68 to 103-110 and applies upstream 61-102", () =>
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
      Array.from({ length: 50 }, (_, index) => 61 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(61);
  }),
);

freshDatabase("moves fork rows 63-70 to 103-110 and applies upstream 63-102", () =>
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
      Array.from({ length: 48 }, (_, index) => 63 + index),
    );
    yield* assertNormalized(63);
  }),
);

freshDatabase("moves fork rows 68-75 to 103-110 and applies upstream 68-102", () =>
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
      Array.from({ length: 43 }, (_, index) => 68 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(68);
  }),
);

freshDatabase("moves fork rows 70-77 to 103-110 and applies upstream 70-102", () =>
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
      Array.from({ length: 41 }, (_, index) => 70 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    yield* assertNormalized(70);
  }),
);

freshDatabase("moves fork rows 78-85 to 103-110 and applies upstream 78-102", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A fork database as the v0.1.6 sync left it: upstream 1-77 are recorded,
    // and the fork block sits on 78-85.
    yield* runMigrations({ toMigrationInclusive: 77 });
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(78)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      Array.from({ length: 33 }, (_, index) => 78 + index),
    );
    assert.deepStrictEqual(yield* schemaNames(), EXPECTED_SCHEMA_NAMES);
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(scheduled_tasks)`;
    assert.isTrue(columns.some((column) => column.name === "thread_mode"));
    yield* assertNormalized(78);
  }),
);

freshDatabase("moves fork rows 81-88 to 103-110 and applies upstream 81-102", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A fork database as the v0.1.7 sync left it: upstream 1-80 are recorded,
    // and the fork block sits on 81-88.
    yield* runMigrations({ toMigrationInclusive: 80 });
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(81)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      Array.from({ length: 30 }, (_, index) => 81 + index),
    );
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(projection_projects)`;
    assert.isTrue(columns.some((column) => column.name === "has_custom_title"));
    yield* assertNormalized(81);
  }),
);

freshDatabase("moves fork rows 96-103 to 103-110 and applies upstream 96-102", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    // A fork database as the v0.1.10 sync left it: upstream 1-95 are recorded,
    // and the fork block sits on 96-103.
    yield* runMigrations({ toMigrationInclusive: 95 });
    for (const [, migration] of FORK_MIGRATIONS) yield* migration;
    for (const [id, name] of forkLedger(96)) {
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})`;
    }

    const ran = yield* runMigrations();
    assert.deepStrictEqual(
      ran.map(([id]) => id),
      Array.from({ length: 15 }, (_, index) => 96 + index),
    );
    yield* assertNormalized(96);
  }),
);
