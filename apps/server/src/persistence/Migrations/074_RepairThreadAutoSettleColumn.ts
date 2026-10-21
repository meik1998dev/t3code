// Fork databases had already recorded migration 59 when upstream added 54
// (ProjectionThreadsAutoSettleDisabledAt). The runner only runs IDs above the
// latest recorded one, so those databases skip 54 and lack
// auto_settle_disabled_at. Upstream's 54 checks for the column first, so
// running it again is a no-op on fresh databases.
export { default } from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";
