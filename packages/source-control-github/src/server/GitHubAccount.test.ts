import { afterEach, assert, describe, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { ChildProcessSpawner } from "effect/process";
import * as SourceControlHost from "@t3tools/source-control-core/server/SourceControlHost";
import * as TestSourceControlHost from "@t3tools/source-control-testing/TestSourceControlHost";

import * as GitHubAccount from "./GitHubAccount.ts";
import { RepositoryGitHubAccount } from "./GitHubCredentials.ts";

const processOutput = (
  stdout: string,
  exitCode = 0,
): SourceControlHost.SourceControlProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(exitCode),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<SourceControlHost.SourceControlHost["Service"]["process"]["run"]>();
const makeAccount = GitHubAccount.make.pipe(
  Effect.provide(TestSourceControlHost.layer({ process: { run: mockRun } })),
);

afterEach(() => {
  mockRun.mockReset();
});

describe("GitHubAccount", () => {
  it.effect("reads gh.account once per cwd and treats a missing key as no account", () =>
    Effect.gen(function* () {
      mockRun
        .mockReturnValueOnce(Effect.succeed(processOutput("octocat\n")))
        .mockReturnValueOnce(Effect.succeed(processOutput("", 1)));
      const account = yield* makeAccount;

      assert.strictEqual(yield* account.accountKeyFor("/work"), "octocat");
      assert.strictEqual(yield* account.accountKeyFor("/work"), "octocat");
      assert.isNull(yield* account.accountKeyFor("/other"));
      assert.strictEqual(mockRun.mock.calls.length, 2);
      assert.deepEqual(mockRun.mock.calls[0]?.[0].args, ["config", "--get", "gh.account"]);
    }),
  );

  it.effect("runs each repository's requests under its own gh.account", () =>
    Effect.gen(function* () {
      mockRun.mockImplementation((input) =>
        Effect.succeed(processOutput(input.cwd === "/work" ? "octocat\n" : "", 0)),
      );
      const account = yield* makeAccount;
      const service = GitHubAccount.scopeToRepositoryAccounts(account, {
        read: (_input: { readonly cwd: string }) =>
          Effect.gen(function* () {
            return yield* RepositoryGitHubAccount;
          }),
        label: "unchanged",
      });

      assert.strictEqual(yield* service.read({ cwd: "/work" }), "octocat");
      assert.isNull(yield* service.read({ cwd: "/personal" }));
      assert.strictEqual(service.label, "unchanged");
    }),
  );
});
