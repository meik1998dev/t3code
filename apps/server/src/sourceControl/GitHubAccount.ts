import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as VcsProcess from "../vcs/VcsProcess.ts";

/**
 * Git config key naming the signed-in `gh` account a repository should use. Set per repository
 * with `git config gh.account <login>`; repositories without it use the active `gh` account.
 */
export const GITHUB_ACCOUNT_CONFIG_KEY = "gh.account";
const ENV_CACHE_CAPACITY = 256;
const ENV_CACHE_TTL = Duration.seconds(30);

/** The repository names an account, but `gh` holds no token for it. */
export class GitHubAccountUnavailableError extends Schema.TaggedErrorClass<GitHubAccountUnavailableError>()(
  "GitHubAccountUnavailableError",
  {
    command: Schema.Literal("gh"),
    cwd: Schema.String,
    account: Schema.String,
    cause: Schema.Defect(),
  },
) {
  get detail(): string {
    return `GitHub account "${this.account}" (from git config ${GITHUB_ACCOUNT_CONFIG_KEY}) is not signed in to GitHub CLI. Run \`gh auth login\` for that account, or unset the key.`;
  }

  override get message(): string {
    return `GitHub CLI failed in envFor: ${this.detail}`;
  }
}

export class GitHubAccount extends Context.Service<
  GitHubAccount,
  {
    /** The configured account for this repository, or null when `gh` should use its active account. */
    readonly accountKeyFor: (cwd: string) => Effect.Effect<string | null>;

    /**
     * Environment overrides for `gh` runs in this repository: a `GH_TOKEN` for the configured
     * account, or none when the repository names no account.
     */
    readonly envFor: (
      cwd: string,
    ) => Effect.Effect<Option.Option<NodeJS.ProcessEnv>, GitHubAccountUnavailableError>;
  }
>()("t3/sourceControl/GitHubAccount") {}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;

  // A missing key, a directory outside git, or a missing git binary all mean "no account":
  // gh itself reports the real problem on the call that follows.
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

  const readToken = (cwd: string, account: string) =>
    process
      .run({
        operation: "GitHubAccount.readToken",
        command: "gh",
        args: ["auth", "token", "--user", account],
        cwd,
      })
      .pipe(
        Effect.mapError(
          (cause) => new GitHubAccountUnavailableError({ command: "gh", cwd, account, cause }),
        ),
        Effect.map((output) => output.stdout.trim()),
        Effect.flatMap((token) =>
          token.length > 0
            ? Effect.succeed(token)
            : Effect.fail(
                new GitHubAccountUnavailableError({
                  command: "gh",
                  cwd,
                  account,
                  cause: "GitHub CLI returned an empty token.",
                }),
              ),
        ),
      );

  // Cache successful resolutions per cwd for 30 seconds to avoid repeating account and token
  // subprocesses on every gh call. Failed resolutions are not cached, so a login or logout takes
  // effect within the short TTL without requiring a server restart.
  const envCache = yield* Cache.makeWith(
    (cwd: string) =>
      readAccount(cwd).pipe(
        Effect.flatMap((account) =>
          account.length === 0
            ? Effect.succeedNone
            : readToken(cwd, account).pipe(Effect.map((token) => Option.some({ GH_TOKEN: token }))),
        ),
      ),
    {
      capacity: ENV_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? ENV_CACHE_TTL : Duration.zero),
    },
  );

  const envFor: GitHubAccount["Service"]["envFor"] = (cwd) => Cache.get(envCache, cwd);

  const accountKeyFor: GitHubAccount["Service"]["accountKeyFor"] = (cwd) =>
    readAccount(cwd).pipe(Effect.map((account) => (account.length === 0 ? null : account)));

  return GitHubAccount.of({ accountKeyFor, envFor });
});

export const layer = Layer.effect(GitHubAccount, make);
