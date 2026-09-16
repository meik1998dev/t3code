import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import repairUpstreamMigrations from "./054_RepairUpstreamMigrationsAfterFork.ts";

it.layer(NodeSqliteClient.layerMemory())("054_RepairUpstreamMigrationsAfterFork", (it) => {
  it.effect("runs upstream migrations a fork database recorded as done", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });

      // A fork database ran its own 50-52 and the fork migrations now at 51-53.
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name) VALUES
          (50, 'ThreadTaskPlanLookup'),
          (51, 'RepairThreadBranchPullRequestColumn'),
          (52, 'ProjectionThreadsParentThreadId'),
          (53, 'ProjectionThreadsParentThreadId')
      `;
      yield* sql`ALTER TABLE projection_threads ADD COLUMN parent_thread_id TEXT`;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, linked_pull_request_json,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Linked', '{"instanceId":"codex","model":"gpt-5.4"}',
          '{"projectId":"project-1","repository":"pingdotgg/t3code","number":42,"url":"https://github.com/pingdotgg/t3code/pull/42"}',
          '2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z'
        )
      `;

      const ran = yield* runMigrations();
      assert.deepStrictEqual(
        ran.map(([id]) => id),
        [54],
      );
      // Running it again must not duplicate or fail.
      yield* repairUpstreamMigrations;

      const rows = yield* sql`
        SELECT thread_id AS "threadId", host, repository, number
        FROM projection_thread_pull_requests
      `;
      assert.deepStrictEqual(rows, [
        { threadId: "thread-1", host: "github.com", repository: "pingdotgg/t3code", number: 42 },
      ]);
    }),
  );
});
