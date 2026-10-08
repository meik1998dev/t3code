import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import parentThreadId from "./057_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./058_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./059_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./060_RepairThreadAutoSettleColumn.ts";
import repairUpstreamMigrations from "./061_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./062_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./063_RepairOrchestrationV2AfterFork.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "063_RepairOrchestrationV2AfterFork",
  (it) => {
    it.effect("applies upstream 55 and 56 to a fork database already at 60", () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        yield* runMigrations({ toMigrationInclusive: 54 });
        // The fork's 55-60 as they were recorded before upstream took 55 and 56.
        yield* repairUpstreamMigrations;
        yield* repairThreadTitleState;
        yield* parentThreadId;
        yield* repairBranchPullRequest;
        yield* repairFilesViewed;
        yield* repairAutoSettle;
        yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name) VALUES
            (55, 'RepairUpstreamMigrationsAfterFork'),
            (56, 'RepairThreadTitleStateColumn'),
            (57, 'ProjectionThreadsParentThreadId'),
            (58, 'RepairThreadBranchPullRequestColumn'),
            (59, 'RepairPullRequestFilesViewedTable'),
            (60, 'RepairThreadAutoSettleColumn')
        `;

        const ran = yield* runMigrations();
        assert.deepStrictEqual(
          ran.map(([id]) => id),
          [61, 62, 63],
        );
        const v2Tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_events'
        `;
        assert.lengthOf(v2Tables, 1);
        const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id IN (55, 56)
          ORDER BY migration_id
        `;
        assert.deepStrictEqual(
          ledger.map((row) => [row.migration_id, row.name]),
          [
            [55, "OrchestrationV2"],
            [56, "RemoveRedundantProjectionIndexes"],
          ],
        );

        // A second run must not try to create the V2 tables again.
        yield* repairOrchestrationV2;
      }),
    );
  },
);
