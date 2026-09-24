// Fork guard: a desktop build without the T3 Connect public config ships an app with no
// T3 Connect UI at all (no sign-in, "Your cloud sign-in changed" on every remote
// environment). It happened three times when a DMG was built in a worktree or clone
// that had no `.env`, so the build now stops instead.
import { loadRepoEnv, resolvePublicConfig } from "./public-config.ts";

type Environment = Readonly<Record<string, string | undefined>>;

/** Set to `1` to build on purpose without T3 Connect. */
export const ALLOW_BUILD_WITHOUT_CLOUD_ENV = "T3CODE_ALLOW_BUILD_WITHOUT_CLOUD";

/** The keys `hasCloudPublicConfig()` in the web app needs; empty when all are set. */
export function missingCloudPublicConfig({
  repoRoot,
  baseEnv = process.env,
}: {
  readonly repoRoot: string;
  readonly baseEnv?: Environment;
}): ReadonlyArray<string> {
  if (baseEnv[ALLOW_BUILD_WITHOUT_CLOUD_ENV] === "1") return [];
  const config = resolvePublicConfig(loadRepoEnv({ repoRoot, baseEnv }));
  return [
    ...(config.clerkPublishableKey ? [] : ["T3CODE_CLERK_PUBLISHABLE_KEY"]),
    ...(config.clerkJwtTemplate ? [] : ["T3CODE_CLERK_JWT_TEMPLATE"]),
    ...(config.relayUrl ? [] : ["T3CODE_RELAY_URL"]),
  ];
}
