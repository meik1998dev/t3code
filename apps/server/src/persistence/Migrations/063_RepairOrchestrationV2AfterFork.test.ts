import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import parentThreadId from "./064_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./065_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./066_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./067_RepairThreadAutoSettleColumn.ts";
import repairUpstreamMigrations from "./061_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./062_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./063_RepairOrchestrationV2AfterFork.ts";
import repairUpstream57To60 from "./068_RepairUpstream57To60AfterFork.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "063_RepairOrchestrationV2AfterFork",
  (it) => {
    it.effect("applies upstream 55-60 to a fork database already at 60", () =>
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
          [61, 62, 63, 64, 65, 66, 67, 68],
        );
        const v2Tables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'orchestration_v2_events'
        `;
        assert.lengthOf(v2Tables, 1);
        const ledger = yield* sql<{ readonly migration_id: number; readonly name: string }>`
          SELECT migration_id, name FROM effect_sql_migrations WHERE migration_id BETWEEN 55 AND 60
          ORDER BY migration_id
        `;
        assert.deepStrictEqual(
          ledger.map((row) => [row.migration_id, row.name]),
          [
            [55, "OrchestrationV2"],
            [56, "RemoveRedundantProjectionIndexes"],
            [57, "ScheduledTaskWebhooks"],
            [58, "WebhookRelayDeliveries"],
            [59, "McpAppModelContext"],
            [60, "ThreadSnapshotWindowIndexes"],
          ],
        );

        const taskColumns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(scheduled_tasks)
        `;
        assert.isTrue(taskColumns.some((column) => column.name === "webhook_token"));
        const newTables = yield* sql<{ readonly name: string }>`
          SELECT name FROM sqlite_master WHERE type = 'table'
            AND name IN ('scheduled_task_webhook_relay_deliveries', 'mcp_app_model_context')
        `;
        assert.lengthOf(newTables, 2);

        // A second run must not try to create the V2 tables or webhook columns again.
        yield* repairOrchestrationV2;
        yield* repairUpstream57To60;
      }),
    );
  },
);
