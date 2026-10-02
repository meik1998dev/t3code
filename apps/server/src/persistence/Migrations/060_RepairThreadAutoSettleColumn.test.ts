import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "060_RepairThreadAutoSettleColumn",
  (it) => {
    it.effect("restores auto_settle_disabled_at for databases that skipped 54", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 59 });
        // A fork database at 59 never ran upstream's 54.
        yield* sql`ALTER TABLE projection_threads DROP COLUMN auto_settle_disabled_at`;
        yield* runMigrations({ toMigrationInclusive: 60 });
        const columns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
        assert.isTrue(columns.some((column) => column.name === "auto_settle_disabled_at"));
      }),
    );
  },
);
