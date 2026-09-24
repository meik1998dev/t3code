// @effect-diagnostics nodeBuiltinImport:off - Tests write root env files directly.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ALLOW_BUILD_WITHOUT_CLOUD_ENV, missingCloudPublicConfig } from "./cloud-config-guard.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
});

function makeRepo(envFile?: string): string {
  const repoRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-cloud-guard-"));
  temporaryDirectories.push(repoRoot);
  if (envFile !== undefined) NodeFS.writeFileSync(NodePath.join(repoRoot, ".env"), envFile);
  return repoRoot;
}

describe("missingCloudPublicConfig", () => {
  it("lists every missing key when the checkout has no .env", () => {
    expect(missingCloudPublicConfig({ repoRoot: makeRepo(), baseEnv: {} })).toEqual([
      "T3CODE_CLERK_PUBLISHABLE_KEY",
      "T3CODE_CLERK_JWT_TEMPLATE",
      "T3CODE_RELAY_URL",
    ]);
  });

  it("passes when .env has the T3 Connect values", () => {
    const repoRoot = makeRepo(
      [
        "T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_x",
        "T3CODE_CLERK_JWT_TEMPLATE=relay",
        "T3CODE_RELAY_URL=https://relay.example",
      ].join("\n"),
    );
    expect(missingCloudPublicConfig({ repoRoot, baseEnv: {} })).toEqual([]);
  });

  it("can be skipped on purpose", () => {
    expect(
      missingCloudPublicConfig({
        repoRoot: makeRepo(),
        baseEnv: { [ALLOW_BUILD_WITHOUT_CLOUD_ENV]: "1" },
      }),
    ).toEqual([]);
  });
});
