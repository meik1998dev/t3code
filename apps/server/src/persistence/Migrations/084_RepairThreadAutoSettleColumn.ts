// Fork databases recorded 59 before upstream added 54, so they skip 54 and lack
// auto_settle_disabled_at. Upstream's 54 checks for the column first, so running it again
// is a no-op on fresh databases.
export { default } from "./054_ProjectionThreadsAutoSettleDisabledAt.ts";
