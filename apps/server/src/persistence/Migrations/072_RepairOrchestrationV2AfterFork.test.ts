import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "../Migrations.ts";
import parentThreadId from "./073_ProjectionThreadsParentThreadId.ts";
import repairBranchPullRequest from "./074_RepairThreadBranchPullRequestColumn.ts";
import repairFilesViewed from "./075_RepairPullRequestFilesViewedTable.ts";
import repairAutoSettle from "./076_RepairThreadAutoSettleColumn.ts";
import repairUpstreamMigrations from "./070_RepairUpstreamMigrationsAfterFork.ts";
import repairThreadTitleState from "./071_RepairThreadTitleStateColumn.ts";
import repairOrchestrationV2 from "./072_RepairOrchestrationV2AfterFork.ts";
import repairUpstream57To60 from "./077_RepairUpstream57To60AfterFork.ts";

it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))(
  "072_RepairOrchestrationV2AfterFork",
  (it) => {
    it.effect("repairs a fork database already at 60 that startup refuses", () =>
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

        // Startup now refuses this ledger before any migration runs, so such a
        // database must first open in the v0.0.46 build (see FORK.md "Migrations").
        // The repairs themselves are still checked by calling them directly.
        const refused = yield* Effect.flip(runMigrations());
        assert.include(refused.message, "would skip required schema migrations");
        yield* repairOrchestrationV2;
        yield* repairUpstream57To60;
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
