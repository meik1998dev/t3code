import * as Effect from "effect/Effect";
import * as Migrator from "effect/sql/Migrator";
import * as SqlClient from "effect/sql/SqlClient";

import PullRequestReviewGuides from "./Migrations/061_PullRequestReviewGuides.ts";
import ThreadFailureLookupIndex from "./Migrations/062_ThreadFailureLookupIndex.ts";
import DropUnusedV1Projections from "./Migrations/063_DropUnusedV1Projections.ts";
import CanonicalizeThreadPullRequestLinks from "./Migrations/064_CanonicalizeThreadPullRequestLinks.ts";
import CodexUsageNativeTurnIndex from "./Migrations/065_CodexUsageNativeTurnIndex.ts";
import RepairClientSettlementTimestamps from "./Migrations/066_RepairClientSettlementTimestamps.ts";
import WebhookDedupe from "./Migrations/067_WebhookDedupe.ts";
import ShellStopRequestIndex from "./Migrations/068_ShellStopRequestIndex.ts";
import ThreadMessageSearch from "./Migrations/069_ThreadMessageSearch.ts";

// The runner only runs ids above the highest recorded one, so every upstream
// migration numbered below the fork's block was skipped on a fork database.
// This file is the one place that repairs that: apply the skipped upstream
// migrations, then move the fork block onto the ids it owns in this build.
// Each sync that takes upstream numbers again adds a generation here.
//
// Generations: fork rows at 61-68 (v0.0.46 sync), at 63-70 (v0.1.1 sync),
// at 68-75 (v0.1.1 ledger fix), now 70-77. See FORK.md "Migrations".
const FORK_NAMES = [
  "RepairUpstreamMigrationsAfterFork",
  "RepairThreadTitleStateColumn",
  "RepairOrchestrationV2AfterFork",
  "ProjectionThreadsParentThreadId",
  "RepairThreadBranchPullRequestColumn",
  "RepairPullRequestFilesViewedTable",
  "RepairThreadAutoSettleColumn",
  "RepairUpstream57To60AfterFork",
] as const;
const FORK_FIRST_ID = 70;
const FORK_OLDEST_GENERATION_ID = 61;

/**
 * Upstream's migrations 64 and 66 decode JSON through a Schema, so replaying
 * them here would widen this function's error channel past what the migrator
 * exposes. Report them the way the migrator would instead.
 */
const asMigrationFailure = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.mapError(
      (cause) =>
        new Migrator.MigrationError({
          kind: "Failed",
          message: `Replaying upstream migration ${name} failed.`,
          cause,
        }),
    ),
  );

export const reconcileForkMigrationLedger = Effect.fn("reconcileForkMigrationLedger")(function* () {
  const sql = yield* SqlClient.SqlClient;
  return yield* sql.withTransaction(
    Effect.gen(function* () {
      const tables = yield* sql`
          SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'
        `;
      if (tables.length === 0) return [];

      // The fork block always starts with this name, wherever that generation
      // put it, so it identifies both the generation and whether work is left.
      const marker = yield* sql<{ readonly migration_id: number }>`
          SELECT migration_id FROM effect_sql_migrations
          WHERE name = 'RepairUpstreamMigrationsAfterFork'
        `;
      const forkStart = marker[0]?.migration_id;
      // Ledgers from before the v0.0.46 sync (fork block at 50-54 or 55-60) predate the V2
      // schema the replays below index. The migrator and the fork's own repairs handle the
      // first; the startup check refuses the second.
      if (
        forkStart === undefined ||
        forkStart < FORK_OLDEST_GENERATION_ID ||
        forkStart >= FORK_FIRST_ID
      ) {
        return [];
      }
      const shift = FORK_FIRST_ID - forkStart;

      // Keyed by name, not id: a fork row sits on the id an upstream migration
      // needs, so an id check would report upstream as applied when it is not.
      const recorded = new Set(
        (yield* sql<{ readonly name: string }>`
              SELECT name FROM effect_sql_migrations
            `).map((row) => row.name),
      );
      const applied: Array<readonly [number, string]> = [];

      // 61 creates its table only when missing, and 63/64 are idempotent by
      // construction. The rest are not, so each checks for what it creates.
      if (!recorded.has("PullRequestReviewGuides")) {
        yield* PullRequestReviewGuides;
        applied.push([61, "PullRequestReviewGuides"]);
      }
      if (!recorded.has("ThreadFailureLookupIndex")) {
        const index = yield* sql`
            SELECT 1 FROM sqlite_master
            WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_failed_error_idx'
          `;
        if (index.length === 0) yield* ThreadFailureLookupIndex;
        applied.push([62, "ThreadFailureLookupIndex"]);
      }
      if (!recorded.has("DropUnusedV1Projections")) {
        yield* DropUnusedV1Projections;
        applied.push([63, "DropUnusedV1Projections"]);
      }
      if (!recorded.has("CanonicalizeThreadPullRequestLinks")) {
        yield* asMigrationFailure(
          "CanonicalizeThreadPullRequestLinks",
          CanonicalizeThreadPullRequestLinks,
        );
        applied.push([64, "CanonicalizeThreadPullRequestLinks"]);
      }
      if (!recorded.has("CodexUsageNativeTurnIndex")) {
        const index = yield* sql`
            SELECT 1 FROM sqlite_master
            WHERE type = 'index' AND name = 'orchestration_v2_provider_turns_codex_native_id_idx'
          `;
        if (index.length === 0) yield* CodexUsageNativeTurnIndex;
        applied.push([65, "CodexUsageNativeTurnIndex"]);
      }
      if (!recorded.has("RepairClientSettlementTimestamps")) {
        yield* asMigrationFailure(
          "RepairClientSettlementTimestamps",
          RepairClientSettlementTimestamps,
        );
        applied.push([66, "RepairClientSettlementTimestamps"]);
      }
      if (!recorded.has("WebhookDedupe")) {
        const columns = yield* sql<{ readonly name: string }>`
            PRAGMA table_info(scheduled_tasks)
          `;
        if (!columns.some((column) => column.name === "last_run_webhook_delivery_id")) {
          yield* WebhookDedupe;
        }
        applied.push([67, "WebhookDedupe"]);
      }
      if (!recorded.has("ShellStopRequestIndex")) {
        const index = yield* sql`
            SELECT 1 FROM sqlite_master
            WHERE type = 'index' AND name = 'orchestration_v2_projection_turn_items_stop_request_idx'
          `;
        if (index.length === 0) yield* ShellStopRequestIndex;
        applied.push([68, "ShellStopRequestIndex"]);
      }
      // 69 creates its table and triggers together, or nothing when FTS5 is unavailable.
      if (!recorded.has("ThreadMessageSearch")) {
        const table = yield* sql`
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'orchestration_v2_message_search'
          `;
        if (table.length === 0) yield* ThreadMessageSearch;
        applied.push([69, "ThreadMessageSearch"]);
      }

      // Highest id first so each move lands on an id the block released.
      for (let index = FORK_NAMES.length - 1; index >= 0; index -= 1) {
        yield* sql`
            UPDATE effect_sql_migrations SET migration_id = ${forkStart + index + shift}
            WHERE migration_id = ${forkStart + index} AND name = ${FORK_NAMES[index]}
          `;
      }
      // Recorded only now, while the ids the fork block just vacated are free.
      for (const [id, name] of applied) {
        yield* sql`
            INSERT INTO effect_sql_migrations (migration_id, name) VALUES (${id}, ${name})
          `;
      }
      return applied;
    }),
  );
});
