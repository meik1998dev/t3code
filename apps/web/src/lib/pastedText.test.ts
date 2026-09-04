import { describe, expect, it } from "vite-plus/test";

import {
  PASTED_TEXT_END,
  PASTED_TEXT_START,
  countPastedTextLines,
  formatPastedTextLabel,
  previewPastedText,
  serializePastedText,
  shouldCompactPastedText,
  stripPastedTextMarkers,
} from "./pastedText";

describe("shouldCompactPastedText", () => {
  it("keeps short pastes inline", () => {
    expect(shouldCompactPastedText("hello world")).toBe(false);
    expect(shouldCompactPastedText("a\nb\nc\nd\ne\nf\ng")).toBe(false);
  });

  it("compacts pastes with many lines", () => {
    expect(shouldCompactPastedText("1\n2\n3\n4\n5\n6\n7\n8")).toBe(true);
  });

  it("compacts long single-line pastes", () => {
    expect(shouldCompactPastedText("x".repeat(1000))).toBe(true);
    expect(shouldCompactPastedText("x".repeat(999))).toBe(false);
  });
});

describe("serializePastedText", () => {
  it("wraps the text in markers and normalizes CRLF", () => {
    expect(serializePastedText("a\r\nb")).toBe(`${PASTED_TEXT_START}a\nb${PASTED_TEXT_END}`);
  });

  it("drops marker characters found inside the pasted text", () => {
    expect(serializePastedText(`a${PASTED_TEXT_END}b${PASTED_TEXT_START}c`)).toBe(
      `${PASTED_TEXT_START}abc${PASTED_TEXT_END}`,
    );
  });
});

describe("stripPastedTextMarkers", () => {
  it("keeps the pasted content and removes only the markers", () => {
    const prompt = `Look at ${serializePastedText("line 1\nline 2")} please`;
    expect(stripPastedTextMarkers(prompt)).toBe("Look at line 1\nline 2 please");
  });

  it("leaves prompts without markers untouched", () => {
    expect(stripPastedTextMarkers("plain @AGENTS.md text")).toBe("plain @AGENTS.md text");
  });
});

describe("formatPastedTextLabel", () => {
  it("counts lines for multi-line pastes", () => {
    expect(countPastedTextLines("a\nb\nc")).toBe(3);
    expect(formatPastedTextLabel("a\nb\nc")).toBe("Pasted text · 3 lines");
  });

  it("falls back to a character count for one long line", () => {
    expect(formatPastedTextLabel("x".repeat(1200))).toBe("Pasted text · 1,200 characters");
  });
});

describe("previewPastedText", () => {
  it("returns short text unchanged", () => {
    expect(previewPastedText("a\nb")).toBe("a\nb");
  });

  it("truncates to the first lines and marks the cut", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    const preview = previewPastedText(text);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview.split("\n")).toHaveLength(8);
  });

  it("truncates one long line by characters", () => {
    const preview = previewPastedText("x".repeat(1200));
    expect(preview).toHaveLength(401);
    expect(preview.endsWith("…")).toBe(true);
  });
});
