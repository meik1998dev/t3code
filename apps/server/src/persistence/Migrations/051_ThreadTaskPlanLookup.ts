import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Shell snapshots seek one plan per latest turn, never scan tool history.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_task_plan
    ON projection_thread_activities(thread_id, turn_id, sequence, created_at, activity_id)
    WHERE kind = 'turn.plan.updated'
  `;
});
