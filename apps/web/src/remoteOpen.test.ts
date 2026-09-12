import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
  RelayConnectionTarget,
  SshConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { buildRemoteOpenUrl, EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { openRemoteEditor, resolveRemoteOpenState } from "./remoteOpen";

const environmentId = EnvironmentId.make("environment-1");

const primaryTarget = (httpBaseUrl: string) =>
  new PrimaryConnectionTarget({
    environmentId,
    label: "sol",
    httpBaseUrl,
    wsBaseUrl: httpBaseUrl.replace("http", "ws"),
  });

const TAILSCALE_TARGETS = [
  { kind: "tailscale", host: "sol.tail1234.ts.net" },
  { kind: "mdns", host: "sol.local" },
] as const;

describe("resolveRemoteOpenState", () => {
  it("keeps exec behavior for a loopback primary target", () => {
    expect(
      resolveRemoteOpenState({
        target: primaryTarget("http://127.0.0.1:8000"),
        sshAlias: null,
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("uses deep links for a primary target reached over the network", () => {
    expect(
      resolveRemoteOpenState({
        target: primaryTarget("https://sol.tail1234.ts.net"),
        sshAlias: null,
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({
      mode: "remote-links",
      host: { kind: "tailscale", host: "sol.tail1234.ts.net" },
    });
  });

  it("keeps exec behavior for the desktop app's own primary even on a NAT URL", () => {
    // wsl-only mode binds the primary to the WSL2 NAT address; it is still
    // this machine because the desktop app manages its own primary backend.
    expect(
      resolveRemoteOpenState({
        target: primaryTarget("http://172.29.112.1:14369"),
        sshAlias: null,
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("keeps exec behavior for desktop-local secondary backends", () => {
    expect(
      resolveRemoteOpenState({
        target: new BearerConnectionTarget({
          environmentId,
          label: "WSL (Ubuntu)",
          connectionId: "local:wsl-1",
        }),
        sshAlias: null,
        isDesktopRenderer: false,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "local-exec" });
  });

  it("prefers the desktop SSH alias over server-advertised hosts", () => {
    expect(
      resolveRemoteOpenState({
        target: new SshConnectionTarget({
          environmentId,
          label: "sol",
          connectionId: "ssh-1",
        }),
        sshAlias: "sol",
        isDesktopRenderer: true,
        remoteOpenTargets: TAILSCALE_TARGETS,
      }),
    ).toEqual({ mode: "remote-links", host: { kind: "ssh-alias", host: "sol" } });
  });

  it("reports unavailable when a remote environment advertises no hosts", () => {
    for (const remoteOpenTargets of [[], undefined] as const) {
      expect(
        resolveRemoteOpenState({
          target: new RelayConnectionTarget({ environmentId, label: "sol" }),
          sshAlias: null,
          isDesktopRenderer: false,
          remoteOpenTargets,
        }),
      ).toEqual({ mode: "remote-unavailable" });
    }
  });

  it("falls back to exec when the environment has no catalog entry", () => {
    expect(
      resolveRemoteOpenState({
        target: null,
        sshAlias: null,
        isDesktopRenderer: false,
        remoteOpenTargets: undefined,
      }),
    ).toEqual({ mode: "local-exec" });
  });
});

describe("buildRemoteOpenUrl", () => {
  it("builds a vscode-remote deep link", () => {
    expect(
      buildRemoteOpenUrl({
        editor: "vscode",
        host: "sol.tail1234.ts.net",
        absolutePath: "/home/theo/code/my repo",
      }),
    ).toBe("vscode://vscode-remote/ssh-remote+sol.tail1234.ts.net/home/theo/code/my%20repo");
  });

  it("uses the fork's scheme", () => {
    expect(buildRemoteOpenUrl({ editor: "cursor", host: "sol", absolutePath: "/tmp/x" })).toBe(
      "cursor://vscode-remote/ssh-remote+sol/tmp/x",
    );
  });

  it("roots Windows paths", () => {
    expect(
      buildRemoteOpenUrl({ editor: "vscode", host: "sol", absolutePath: "C:\\Users\\theo" }),
    ).toBe("vscode://vscode-remote/ssh-remote+sol/C%3A/Users/theo");
  });

  it("returns undefined for editors without remote support", () => {
    expect(buildRemoteOpenUrl({ editor: "zed", host: "sol", absolutePath: "/tmp/x" })).toBe(
      undefined,
    );
  });
});

describe("openRemoteEditor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs ssh-cli editors through the desktop bridge and reports its answer", async () => {
    const openRemoteEditorCommand = vi.fn(async () => true);
    vi.stubGlobal("window", { desktopBridge: { openRemoteEditorCommand } });

    await expect(
      openRemoteEditor({ editor: "zed", host: "sol", absolutePath: "/tmp/x" }),
    ).resolves.toBe(true);
    expect(openRemoteEditorCommand).toHaveBeenCalledWith({
      editor: "zed",
      host: "sol",
      absolutePath: "/tmp/x",
    });
  });

  it("reports false for ssh-cli editors when the bridge cannot spawn them", async () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    await expect(
      openRemoteEditor({ editor: "zed", host: "sol", absolutePath: "/tmp/x" }),
    ).resolves.toBe(false);

    vi.stubGlobal("window", {
      desktopBridge: { openRemoteEditorCommand: async () => Promise.reject(new Error("no")) },
    });
    await expect(
      openRemoteEditor({ editor: "zed", host: "sol", absolutePath: "/tmp/x" }),
    ).resolves.toBe(false);
  });

  it("hands deep-link editors to the shell as before", async () => {
    const openExternal = vi.fn(async () => true);
    vi.stubGlobal("window", { desktopBridge: { openExternal } });

    await expect(
      openRemoteEditor({ editor: "vscode", host: "sol", absolutePath: "/tmp/x" }),
    ).resolves.toBe(true);
    expect(openExternal).toHaveBeenCalledWith("vscode://vscode-remote/ssh-remote+sol/tmp/x");
  });

  it("reports false for editors without remote support", async () => {
    vi.stubGlobal("window", { desktopBridge: {} });
    await expect(
      openRemoteEditor({ editor: "idea", host: "sol", absolutePath: "/tmp/x" }),
    ).resolves.toBe(false);
  });
});
