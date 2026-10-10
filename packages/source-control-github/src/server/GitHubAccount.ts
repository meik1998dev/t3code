import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";

import { RepositoryGitHubAccount } from "./GitHubCredentials.ts";

/**
 * Git config key naming the signed-in `gh` account a repository should use. Set per repository
 * with `git config gh.account <login>`; repositories without it use the host's account.
 */
export const GITHUB_ACCOUNT_CONFIG_KEY = "gh.account";
const ACCOUNT_CACHE_CAPACITY = 256;
const ACCOUNT_CACHE_TTL = Duration.seconds(30);

export class GitHubAccount extends Context.Service<
  GitHubAccount,
  {
    /** The configured account for this repository, or null when the host's account applies. */
    readonly accountKeyFor: (cwd: string) => Effect.Effect<string | null>;
  }
>()("@t3tools/source-control-github/server/GitHubAccount") {}

export const make = Effect.gen(function* () {
  const { process } = yield* SourceControlHost.SourceControlHost;

  // A missing key, a directory outside git, or a missing git binary all mean "no account":
  // the GitHub request that follows reports the real problem.
  const readAccount = (cwd: string) =>
    process
      .run({
        operation: "GitHubAccount.readAccount",
        command: "git",
        args: ["config", "--get", GITHUB_ACCOUNT_CONFIG_KEY],
        cwd,
        allowNonZeroExit: true,
      })
      .pipe(
        Effect.map((output) => (output.exitCode === 0 ? output.stdout.trim() : "")),
        Effect.orElseSucceed(() => ""),
      );

  // Holds a cwd's answer for 30 seconds, so a page that runs several GitHub reads per project
  // spawns `git config` once per project.
  const accountCache = yield* Cache.makeWith(
    (cwd: string) =>
      readAccount(cwd).pipe(Effect.map((account) => (account.length === 0 ? null : account))),
    { capacity: ACCOUNT_CACHE_CAPACITY, timeToLive: () => ACCOUNT_CACHE_TTL },
  );

  return GitHubAccount.of({ accountKeyFor: (cwd) => Cache.get(accountCache, cwd) });
});

export const layer = Layer.effect(GitHubAccount, make);

/** Runs `effect` with the credential of the repository's `gh.account`, when it names one. */
export const withRepositoryAccount =
  (account: GitHubAccount["Service"], cwd: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    account
      .accountKeyFor(cwd)
      .pipe(
        Effect.flatMap((key) =>
          key === null ? effect : Effect.provideService(effect, RepositoryGitHubAccount, key),
        ),
      );

/**
 * Wraps each method of a GitHub service whose first argument has a `cwd` and that returns an
 * Effect, so every request it makes uses that repository's `gh.account`. Other methods pass
 * through unchanged.
 */
export function scopeToRepositoryAccounts<S extends object>(
  account: GitHubAccount["Service"],
  service: S,
): S {
  const scoped: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(service)) {
    scoped[name] =
      typeof value !== "function"
        ? value
        : (...args: ReadonlyArray<unknown>) => {
            const result: unknown = Reflect.apply(value, service, args);
            const [input] = args;
            const cwd =
              typeof input === "object" && input !== null && "cwd" in input ? input.cwd : null;
            if (typeof cwd !== "string" || !Effect.isEffect(result)) return result;
            // The wrapped method's own types are restored by the `S` return type.
            // @effect-diagnostics-next-line anyUnknownInErrorContext:off
            return withRepositoryAccount(account, cwd)(result);
          };
  }
  return scoped as S;
}
