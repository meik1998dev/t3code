import { describe, expect, it } from "vite-plus/test";

import {
  detectComposerTrigger,
  serializeComposerFileLink,
  serializeComposerMentionPath,
} from "./composerTrigger.ts";

describe("serializeComposerMentionPath", () => {
  it("keeps simple mention paths unquoted", () => {
    expect(serializeComposerMentionPath("src/index.ts")).toBe("src/index.ts");
  });

  it("quotes mention paths containing whitespace", () => {
    expect(serializeComposerMentionPath("docs/My File.md")).toBe('"docs/My File.md"');
  });

  it("escapes quoted mention path content", () => {
    expect(serializeComposerMentionPath('docs/My "File".md')).toBe('"docs/My \\"File\\".md"');
  });
});

describe("serializeComposerFileLink", () => {
  it("uses the basename as the markdown label", () => {
    expect(serializeComposerFileLink("path/to/package.json")).toBe(
      "[package.json](path/to/package.json)",
    );
  });

  it("encodes markdown-sensitive destination characters", () => {
    expect(serializeComposerFileLink("docs/My File (draft).md")).toBe(
      "[My File (draft).md](docs/My%20File%20%28draft%29.md)",
    );
  });

  it("supports windows paths", () => {
    expect(serializeComposerFileLink("C:\\repo\\src\\index.ts")).toBe(
      "[index.ts](C:%5Crepo%5Csrc%5Cindex.ts)",
    );
  });

  it("preserves paths that legitimately start with an at sign", () => {
    expect(serializeComposerFileLink("@scope/package.json")).toBe(
      "[package.json](@scope/package.json)",
    );
  });
});

describe("detectComposerTrigger", () => {
  it("detects slash command at the prompt start", () => {
    const text = "/rev";
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "slash-command",
      query: "rev",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects slash command in the middle of existing text", () => {
    const text = "Please run /rev";
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "slash-command",
      query: "rev",
      rangeStart: "Please run ".length,
      rangeEnd: text.length,
    });
  });

  it("does not treat a slash inside a word as a command trigger", () => {
    const text = "open src/app";
    expect(detectComposerTrigger(text, text.length)).toBeNull();
  });

  it("keeps /model with arguments as a line-start model trigger", () => {
    const text = "/model spark";
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "slash-model",
      query: "spark",
      rangeStart: 0,
      rangeEnd: text.length,
    });
  });

  it("detects $skill trigger in the middle of existing text", () => {
    const text = "Use $gh-fi";
    expect(detectComposerTrigger(text, text.length)).toEqual({
      kind: "skill",
      query: "gh-fi",
      rangeStart: "Use ".length,
      rangeEnd: text.length,
    });
  });
});
