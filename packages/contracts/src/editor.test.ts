import { describe, expect, it } from "vite-plus/test";

import {
  buildRemoteEditorCommand,
  buildRemoteOpenUrl,
  REMOTE_CAPABLE_EDITOR_IDS,
  remoteLaunchKindForEditor,
} from "./editor.ts";

describe("remote editor launch kinds", () => {
  it("offers Zed remotely through its ssh:// CLI, next to the deep-link editors", () => {
    expect(REMOTE_CAPABLE_EDITOR_IDS).toContain("zed");
    expect(remoteLaunchKindForEditor("zed")).toBe("ssh-cli");
    expect(remoteLaunchKindForEditor("vscode")).toBe("deep-link");
    expect(remoteLaunchKindForEditor("idea")).toBe(undefined);
  });

  it("keeps deep links for deep-link editors only", () => {
    expect(buildRemoteOpenUrl({ editor: "zed", host: "sol", absolutePath: "/tmp/x" })).toBe(
      undefined,
    );
  });
});

describe("buildRemoteEditorCommand", () => {
  it("builds `zed ssh://<host><path>` with the path percent-encoded", () => {
    expect(
      buildRemoteEditorCommand({
        editor: "zed",
        host: "srv1975423.local",
        absolutePath: "/root/repos/news/my repo",
      }),
    ).toEqual({
      commands: ["zed", "zeditor"],
      args: ["ssh://srv1975423.local/root/repos/news/my%20repo"],
    });
  });

  it("roots Windows paths like the deep-link builder", () => {
    expect(
      buildRemoteEditorCommand({ editor: "zed", host: "sol", absolutePath: "C:\\Users\\theo" })
        ?.args,
    ).toEqual(["ssh://sol/C%3A/Users/theo"]);
  });

  it("returns undefined for editors without CLI remote support", () => {
    expect(
      buildRemoteEditorCommand({ editor: "vscode", host: "sol", absolutePath: "/tmp/x" }),
    ).toBe(undefined);
    expect(
      buildRemoteEditorCommand({ editor: "file-manager", host: "sol", absolutePath: "/tmp/x" }),
    ).toBe(undefined);
  });
});
