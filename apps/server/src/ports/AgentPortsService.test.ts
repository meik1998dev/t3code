import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
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

// Real `ss -ltnpH` output from Ubuntu 24.04: the Next.js name is cut at 15 bytes
// and carries a parenthesis, which is exactly what lsof 4.95 chokes on.
const SS_LISTENERS = [
  `LISTEN 0      511        127.0.0.1:3773 0.0.0.0:* users:(("node",pid=${SERVER_PID},fd=22))`,
  'LISTEN 0      511                *:3000       *:* users:(("next-server (v1",pid=105641,fd=22))',
  'LISTEN 0      4096       127.0.0.53%lo:53  0.0.0.0:* users:(("systemd-resolve",pid=6220,fd=15))',
  'LISTEN 0      128              0.0.0.0:22   0.0.0.0:* users:(("sshd",pid=6208,fd=3),("systemd",pid=1,fd=148))',
  "",
].join("\n");

const PROC_CWDS: Record<string, string> = {
  "/proc/105641/cwd": "/root/repos/shaar/syrian-data-platform-frontend",
  "/proc/6220/cwd": "/",
};

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
              if (request.command === "ss") return Effect.succeed(okResult(SS_LISTENERS));
              if (request.args.includes("cwd")) return Effect.succeed(okResult(LSOF_CWDS));
              return Effect.succeed(okResult(LSOF_LISTENERS));
            }),
        }),
        FileSystem.layerNoop({
          readLink: (path) =>
            path in PROC_CWDS
              ? Effect.succeed(PROC_CWDS[path]!)
              : Effect.fail(
                  PlatformError.systemError({
                    module: "FileSystem",
                    method: "readLink",
                    _tag: "NotFound",
                    pathOrDescriptor: path,
                  }),
                ),
        }),
        Layer.succeed(HostProcessPlatform, input.platform ?? "darwin"),
        Layer.succeed(AgentPortsService.AgentPortsServerPid, SERVER_PID),
      ),
    ),
  );

describe("AgentPortsService parsers", () => {
  it("reads pids and ports from ss, one row per pid", () => {
    assert.deepEqual(AgentPortsService.parseSsListeners(SS_LISTENERS), [
      { pid: SERVER_PID, processName: "node", host: "127.0.0.1", port: 3773 },
      { pid: 105641, processName: "next-server (v1", host: "*", port: 3000 },
      { pid: 6220, processName: "systemd-resolve", host: "127.0.0.53%lo", port: 53 },
      { pid: 6208, processName: "sshd", host: "0.0.0.0", port: 22 },
      { pid: 1, processName: "systemd", host: "0.0.0.0", port: 22 },
    ]);
  });

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

  it("uses ss and /proc on Linux, so a detached Next.js server in a project is found", async () => {
    const calls: Array<ReadonlyArray<string>> = [];
    const result = await Effect.gen(function* () {
      const service = yield* AgentPortsService.AgentPortsService;
      return yield* service.list({ cwdRoots: ["/root/repos/shaar/syrian-data-platform-frontend"] });
    }).pipe(Effect.provide(makeLayer({ platform: "linux", calls })), Effect.runPromise);
    assert.deepEqual(
      result.ports.map((port) => [port.port, port.pid, port.origin, port.cwd]),
      [[3000, 105641, "workspace", "/root/repos/shaar/syrian-data-platform-frontend"]],
    );
    assert.isFalse(calls.some((call) => call[0] === "lsof"));
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
