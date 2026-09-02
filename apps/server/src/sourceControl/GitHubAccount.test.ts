import { assert, it, afterEach, describe, vi } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/unstable/process";
import { VcsProcessExitError } from "@t3tools/contracts";

import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubAccount from "./GitHubAccount.ts";

const processOutput = (stdout: string, exitCode = 0): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();

const layer = GitHubAccount.layer.pipe(
  Layer.provide(Layer.mock(VcsProcess.VcsProcess)({ run: mockRun })),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubAccount.layer", () => {
  it.effect("returns no overrides when the repository names no account", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("", 1)));

      const account = yield* GitHubAccount.GitHubAccount;
      const envs = [yield* account.envFor("/repo"), yield* account.envFor("/repo")];

      assert.isTrue(envs.every(Option.isNone));
      assert.strictEqual(mockRun.mock.calls.length, 1);
      assert.deepEqual(mockRun.mock.calls[0]?.[0].args, ["config", "--get", "gh.account"]);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("caches successful env resolutions within the TTL", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")));

      const account = yield* GitHubAccount.GitHubAccount;
      const first = yield* account.envFor("/repo");
      const second = yield* account.envFor("/repo");

      assert.deepEqual(Option.getOrUndefined(first), { GH_TOKEN: "gho_secret" });
      assert.deepEqual(Option.getOrUndefined(second), { GH_TOKEN: "gho_secret" });
      assert.strictEqual(mockRun.mock.calls.length, 2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("coalesces concurrent env resolutions for a cwd", () =>
    Effect.gen(function* () {
      const tokenStarted = yield* Deferred.make<void>();
      const releaseToken = yield* Deferred.make<void>();
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("octocat\n"))).mockReturnValueOnce(
        Effect.gen(function* () {
          yield* Deferred.succeed(tokenStarted, undefined);
          yield* Deferred.await(releaseToken);
          return processOutput("gho_secret\n");
        }),
      );

      const account = yield* GitHubAccount.GitHubAccount;
      const firstFiber = yield* account.envFor("/repo").pipe(Effect.forkChild);
      yield* Deferred.await(tokenStarted);
      const secondFiber = yield* account.envFor("/repo").pipe(Effect.forkChild);
      yield* Effect.yieldNow;

      assert.strictEqual(mockRun.mock.calls.length, 2);
      yield* Deferred.succeed(releaseToken, undefined);
      const [first, second] = yield* Effect.all([Fiber.join(firstFiber), Fiber.join(secondFiber)]);

      assert.deepEqual(Option.getOrUndefined(first), { GH_TOKEN: "gho_secret" });
      assert.deepEqual(Option.getOrUndefined(second), { GH_TOKEN: "gho_secret" });
    }).pipe(Effect.provide(layer)),
  );

  it.effect("re-reads successful env resolutions after the TTL", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_first\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_second\n")));

      const account = yield* GitHubAccount.GitHubAccount;
      const first = yield* account.envFor("/repo");
      yield* TestClock.adjust("30 seconds");
      const second = yield* account.envFor("/repo");

      assert.deepEqual(Option.getOrUndefined(first), { GH_TOKEN: "gho_first" });
      assert.deepEqual(Option.getOrUndefined(second), { GH_TOKEN: "gho_second" });
      assert.strictEqual(mockRun.mock.calls.length, 4);
    }).pipe(Effect.provide(Layer.merge(layer, TestClock.layer()))),
  );

  it.effect("resolves the configured account to a GH_TOKEN override", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")));

      const account = yield* GitHubAccount.GitHubAccount;
      const env = yield* account.envFor("/repo");

      assert.deepEqual(Option.getOrUndefined(env), { GH_TOKEN: "gho_secret" });
      const tokenCall = mockRun.mock.calls[1]?.[0];
      assert.strictEqual(tokenCall?.command, "gh");
      assert.deepEqual(tokenCall?.args, ["auth", "token", "--user", "octocat"]);
      assert.strictEqual(tokenCall?.cwd, "/repo");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("reads the configured account once for accountKeyFor and envFor", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")));

      const account = yield* GitHubAccount.GitHubAccount;
      const key = yield* account.accountKeyFor("/repo");
      const env = yield* account.envFor("/repo");
      const again = yield* account.accountKeyFor("/repo");

      assert.strictEqual(key, "octocat");
      assert.strictEqual(again, "octocat");
      assert.deepEqual(Option.getOrUndefined(env), { GH_TOKEN: "gho_secret" });
      assert.strictEqual(mockRun.mock.calls.length, 2);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("answers null for a repository that names no account", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("", 1)));

      const account = yield* GitHubAccount.GitHubAccount;
      const key = yield* account.accountKeyFor("/repo");

      assert.isNull(key);
    }).pipe(Effect.provide(layer)),
  );

  it.effect("names the account when gh holds no token for it", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(
          Effect.fail(
            new VcsProcessExitError({
              operation: "GitHubAccount.readToken",
              command: "gh",
              cwd: "/repo",
              exitCode: 1,
              failureKind: "command-failed",
              detail: "no oauth token found for github.com account octocat",
              stderrLength: 52,
              stderrTruncated: false,
            }),
          ),
        )
        .mockReturnValueOnce(Effect.succeed(processOutput("gho_secret\n")));

      const account = yield* GitHubAccount.GitHubAccount;
      const error = yield* account.envFor("/repo").pipe(Effect.flip);
      const env = yield* account.envFor("/repo");

      assert.strictEqual(error._tag, "GitHubAccountUnavailableError");
      assert.strictEqual(error.account, "octocat");
      assert.include(error.detail, "gh auth login");
      // The failed token is not held, so the retry asks gh again; the account read is.
      assert.deepEqual(Option.getOrUndefined(env), { GH_TOKEN: "gho_secret" });
      assert.strictEqual(mockRun.mock.calls.length, 3);
    }).pipe(Effect.provide(layer)),
  );
});
