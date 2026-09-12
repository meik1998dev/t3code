import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, describe, it } from "vite-plus/test";

import * as ProcessRunner from "../processRunner.ts";
import * as AgentPortsService from "./AgentPortsService.ts";

const SERVER_PID = 500;

const LSOF_LISTENERS = [
  "p1",
  "claunchd",
  "n*:22",
  `p${SERVER_PID}`,
  "cnode",
  "n127.0.0.1:3773",
  "p610",
  "cnode",
  "f20",
  "n*:5173",
  "f21",
  "n[::]:5173",
  "p700",
  "cnode",
  "n127.0.0.1:3000",
  "p800",
  "cpostgres",
  "n127.0.0.1:5432",
  "",
].join("\n");

const PS_TABLE = [
  "    1     0 /sbin/launchd",
  `  ${SERVER_PID}     1 node dist/bin.mjs serve`,
  `  600   ${SERVER_PID} claude --print`,
  "  610   600 node node_modules/.bin/vite --port 5173",
  "  700     1 node server.js",
  "  800     1 /opt/homebrew/bin/postgres -D /opt/homebrew/var/postgres",
].join("\n");

const LSOF_CWDS = [
  "p610",
  "fcwd",
  "n/Users/alice/.t3/worktrees/app/abc123",
  "p700",
  "fcwd",
  "n/Users/alice/code/app/apps/web",
  "p800",
  "fcwd",
  "n/opt/homebrew/var",
].join("\n");

const okResult = (stdout: string): ProcessRunner.ProcessRunOutput => ({
  stdout,
  stderr: "",
  code: null,
  timedOut: false,
  stdoutTruncated: false,
  stderrTruncated: false,
  stdoutInvalidUtf8: false,
  stderrInvalidUtf8: false,
});

const makeLayer = (input: {
  readonly platform?: NodeJS.Platform;
  readonly run?: ProcessRunner.ProcessRunner["Service"]["run"];
  readonly calls?: Array<ReadonlyArray<string>>;
}) =>
  AgentPortsService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProcessRunner.ProcessRunner, {
          run:
            input.run ??
            ((request) => {
              input.calls?.push([request.command, ...request.args]);
              if (request.command === "ps") return Effect.succeed(okResult(PS_TABLE));
              if (request.args.includes("cwd")) return Effect.succeed(okResult(LSOF_CWDS));
              return Effect.succeed(okResult(LSOF_LISTENERS));
            }),
        }),
        Layer.succeed(HostProcessPlatform, input.platform ?? "darwin"),
        Layer.succeed(AgentPortsService.AgentPortsServerPid, SERVER_PID),
      ),
    ),
  );

describe("AgentPortsService parsers", () => {
  it("reads one row per pid and port from lsof, ignoring fd lines", () => {
    assert.deepEqual(AgentPortsService.parseLsofListeners(LSOF_LISTENERS), [
      { pid: 1, processName: "launchd", host: "*", port: 22 },
      { pid: SERVER_PID, processName: "node", host: "127.0.0.1", port: 3773 },
      { pid: 610, processName: "node", host: "*", port: 5173 },
      { pid: 700, processName: "node", host: "127.0.0.1", port: 3000 },
      { pid: 800, processName: "postgres", host: "127.0.0.1", port: 5432 },
    ]);
  });

  it("reads pid, ppid and the command line from ps", () => {
    const records = AgentPortsService.parseProcessTable(PS_TABLE);
    assert.deepEqual(records[2], { pid: 600, ppid: SERVER_PID, command: "claude --print" });
    assert.equal(records.length, 6);
  });

  it("reads working directories from lsof", () => {
    const cwds = AgentPortsService.parseLsofCwds(LSOF_CWDS);
    assert.equal(cwds.get(610), "/Users/alice/.t3/worktrees/app/abc123");
    assert.equal(cwds.get(800), "/opt/homebrew/var");
  });

  it("matches a cwd inside a root but not a sibling with the same prefix", () => {
    assert.isTrue(AgentPortsService.isInsideRoot("/code/app/apps/web", "/code/app"));
    assert.isTrue(AgentPortsService.isInsideRoot("/code/app/", "/code/app"));
    assert.isFalse(AgentPortsService.isInsideRoot("/code/app-old", "/code/app"));
  });
});

describe("AgentPortsService.list", () => {
  it("keeps agent children and workspace listeners, drops the server and system ports", () =>
    Effect.gen(function* () {
      const service = yield* AgentPortsService.AgentPortsService;
      const result = yield* service.list({ cwdRoots: ["/Users/alice/code/app"] });
      assert.isTrue(result.supported);
      assert.deepEqual(
        result.ports.map((port) => [port.port, port.origin, port.command, port.cwd]),
        [
          [3000, "workspace", "node server.js", "/Users/alice/code/app/apps/web"],
          [
            5173,
            "agent-process",
            "node node_modules/.bin/vite --port 5173",
            "/Users/alice/.t3/worktrees/app/abc123",
          ],
        ],
      );
    }).pipe(Effect.provide(makeLayer({})), Effect.runPromise));

  it("asks lsof for the cwd of listener pids only, without the server pid", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    await Effect.gen(function* () {
      const service = yield* AgentPortsService.AgentPortsService;
      yield* service.list({ cwdRoots: [] });
    }).pipe(Effect.provide(makeLayer({ calls })), Effect.runPromise);
    const cwdCall = calls.find((call) => call.includes("cwd"));
    assert.deepEqual(cwdCall, ["lsof", "-a", "-p", "1,610,700,800", "-d", "cwd", "-F", "pn"]);
  });

  it("reports unsupported on Windows without running anything", () =>
    Effect.gen(function* () {
      const service = yield* AgentPortsService.AgentPortsService;
      const result = yield* service.list({ cwdRoots: [] });
      assert.deepEqual(result.ports, []);
      assert.isFalse(result.supported);
    }).pipe(
      Effect.provide(
        makeLayer({
          platform: "win32",
          run: () => Effect.die(new Error("must not run")),
        }),
      ),
      Effect.runPromise,
    ));

  it("reports unsupported when lsof is missing", () =>
    Effect.gen(function* () {
      const service = yield* AgentPortsService.AgentPortsService;
      const result = yield* service.list({ cwdRoots: [] });
      assert.deepEqual(result.ports, []);
      assert.isFalse(result.supported);
    }).pipe(
      Effect.provide(
        makeLayer({
          run: (request) =>
            Effect.fail(
              new ProcessRunner.ProcessSpawnError({
                command: request.command,
                argumentCount: request.args.length,
                cause: new Error("ENOENT"),
              }),
            ),
        }),
      ),
      Effect.runPromise,
    ));
});
