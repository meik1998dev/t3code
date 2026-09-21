import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import migrateParentThreadId from "./057_ProjectionThreadsParentThreadId.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "057_ProjectionThreadsParentThreadId",
  (it) => {
    it.effect("gives existing threads no parent and can run twice", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 56 });
        const now = "2026-01-01T00:00:00.000Z";
        yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          created_at, updated_at
        ) VALUES (
          'thread-1', 'project-1', 'Existing thread',
          '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', ${now}, ${now}
        )
      `;
        yield* runMigrations({ toMigrationInclusive: 57 });
        yield* migrateParentThreadId;
        const rows = yield* sql<{ readonly parentThreadId: string | null }>`
        SELECT parent_thread_id AS "parentThreadId" FROM projection_threads WHERE thread_id = 'thread-1'
      `;
        assert.deepEqual(rows, [{ parentThreadId: null }]);
      }),
    );
  },
);
