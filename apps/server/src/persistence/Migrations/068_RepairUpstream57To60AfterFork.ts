import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import ScheduledTaskWebhooks from "./057_ScheduledTaskWebhooks.ts";
import WebhookRelayDeliveries from "./058_WebhookRelayDeliveries.ts";
import McpAppModelContext from "./059_McpAppModelContext.ts";
import ThreadSnapshotWindowIndexes from "./060_ThreadSnapshotWindowIndexes.ts";

// Spindle databases had recorded fork migrations at 57-63 before upstream
// shipped 57-60. The runner only runs ids above the latest recorded one, so
// those databases skip all four. 58-60 only create what is missing. 57 adds
// columns without a check, so it runs only when they are absent. Fresh
// databases already ran 57-60 and this does nothing.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(scheduled_tasks)
  `;
  if (!columns.some((column) => column.name === "webhook_token")) {
    yield* ScheduledTaskWebhooks;
  }
  yield* WebhookRelayDeliveries;
  yield* McpAppModelContext;
  yield* ThreadSnapshotWindowIndexes;
  // Record upstream's names at 57-60 so the ledger matches a fresh database.
  // The fork's own migrations now run again as 64-67, which are idempotent.
  for (const [id, forkName, upstreamName] of [
    [57, "ProjectionThreadsParentThreadId", "ScheduledTaskWebhooks"],
    [58, "RepairThreadBranchPullRequestColumn", "WebhookRelayDeliveries"],
    [59, "RepairPullRequestFilesViewedTable", "McpAppModelContext"],
    [60, "RepairThreadAutoSettleColumn", "ThreadSnapshotWindowIndexes"],
  ] as const) {
    yield* sql`
      UPDATE effect_sql_migrations SET name = ${upstreamName}
      WHERE migration_id = ${id} AND name = ${forkName}
    `;
  }
});
