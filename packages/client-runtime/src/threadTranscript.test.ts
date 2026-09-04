import { describe, expect, it } from "vite-plus/test";
import { buildThreadTranscript } from "./threadTranscript.js";

describe("buildThreadTranscript", () => {
  it("keeps user and assistant text in order under the thread title", () => {
    expect(
      buildThreadTranscript("Fix login", [
        { role: "user", text: "Login fails" },
        { role: "assistant", text: "Found the bug.\n\nFixed it." },
        { role: "user", text: "Thanks" },
      ]),
    ).toBe(
      [
        "# Fix login",
        "**User:**\nLogin fails",
        "**Assistant:**\nFound the bug.\n\nFixed it.",
        "**User:**\nThanks",
      ].join("\n\n"),
    );
  });

  it("drops system messages and empty text", () => {
    expect(
      buildThreadTranscript("Empty", [
        { role: "system", text: "hidden" },
        { role: "assistant", text: "   " },
        { role: "user", text: "only this" },
      ]),
    ).toBe("# Empty\n\n**User:**\nonly this");
  });
});
