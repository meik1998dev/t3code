import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import repairUpstreamMigrations from "./055_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleStateColumn from "./056_RepairThreadTitleStateColumn.ts";

it.layer(NodeSqliteClient.layerMemory())("055_RepairUpstreamMigrationsAfterFork", (it) => {
  it.effect("repairs upstream migrations skipped by an existing fork database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });

      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES
          (50, 'ThreadTaskPlanLookup'),
          (51, 'RepairThreadBranchPullRequestColumn'),
          (52, 'ProjectionThreadsParentThreadId'),
          (53, 'ProjectionThreadsParentThreadId'),
          (54, 'RepairUpstreamMigrationsAfterFork')
      `;

      const ran = yield* runMigrations();
      assert.deepStrictEqual(
        ran.map(([id]) => id),
        [55, 56],
      );

      // Every repair must also be safe when a database already has the schema.
      yield* repairUpstreamMigrations;
      yield* repairThreadTitleStateColumn;

      const messageColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_thread_messages)
      `;
      assert.equal(
        messageColumns.some((column) => column.name === "context_json"),
        true,
      );

      const threadColumns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.equal(
        threadColumns.some((column) => column.name === "branch_pull_request_json"),
        true,
      );
      assert.equal(
        threadColumns.some((column) => column.name === "title_state_json"),
        true,
      );
    }),
  );
});
