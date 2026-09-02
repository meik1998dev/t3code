import { assert, it, afterEach, describe, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
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
      const env = yield* account.envFor("/repo");

      assert.isTrue(Option.isNone(env));
      assert.strictEqual(mockRun.mock.calls.length, 1);
      assert.deepEqual(mockRun.mock.calls[0]?.[0].args, ["config", "--get", "gh.account"]);
    }).pipe(Effect.provide(layer)),
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

  it.effect("names the account when gh holds no token for it", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("octocat\n"))).mockReturnValueOnce(
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
      );

      const account = yield* GitHubAccount.GitHubAccount;
      const error = yield* account.envFor("/repo").pipe(Effect.flip);

      assert.strictEqual(error._tag, "GitHubAccountUnavailableError");
      assert.strictEqual(error.account, "octocat");
      assert.include(error.detail, "gh auth login");
    }).pipe(Effect.provide(layer)),
  );
});
