import { describe, expect, it } from "vite-plus/test";

import { buildLinearIssuePrompt, sortLinearIssues, type LinearIssueSummary } from "./linear.ts";

function issue(
  id: string,
  type: LinearIssueSummary["state"]["type"],
  updatedAt: string,
): LinearIssueSummary {
  return {
    id,
    identifier: id.toUpperCase(),
    title: id,
    url: `https://linear.app/t3/issue/${id}`,
    branchName: null,
    priority: 0,
    updatedAt,
    state: { name: type, type, color: "#000" },
  };
}

describe("sortLinearIssues", () => {
  it("puts started work first and newest updates first within a state", () => {
    const sorted = sortLinearIssues([
      issue("backlog-old", "backlog", "2026-01-01T00:00:00.000Z"),
      issue("started-old", "started", "2026-01-01T00:00:00.000Z"),
      issue("triage", "triage", "2026-03-01T00:00:00.000Z"),
      issue("started-new", "started", "2026-02-01T00:00:00.000Z"),
      issue("unstarted", "unstarted", "2026-04-01T00:00:00.000Z"),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual([
      "started-new",
      "started-old",
      "unstarted",
      "triage",
      "backlog-old",
    ]);
  });
});

describe("buildLinearIssuePrompt", () => {
  it("writes the key, link, description and comments in order", () => {
    const prompt = buildLinearIssuePrompt({
      ...issue("eng-1", "started", "2026-01-01T00:00:00.000Z"),
      title: "Add login",
      description: "Users need a login page.\n\n- email\n- password",
      comments: [
        { author: "Hanaa", createdAt: "2026-09-01T10:00:00.000Z", body: "Also handle empty state" },
        { author: null, createdAt: "2026-09-02T10:00:00.000Z", body: "Agreed" },
      ],
    });
    expect(prompt).toBe(
      [
        "Linear ENG-1: Add login",
        "https://linear.app/t3/issue/eng-1",
        "",
        "Users need a login page.\n\n- email\n- password",
        "",
        "## Comments",
        "- **Hanaa**, 2026-09-01: Also handle empty state",
        "- **Unknown**, 2026-09-02: Agreed",
      ].join("\n"),
    );
  });

  it("leaves out empty sections", () => {
    const prompt = buildLinearIssuePrompt({
      ...issue("eng-2", "backlog", "2026-01-01T00:00:00.000Z"),
      description: "   ",
      comments: [],
    });
    expect(prompt).toBe("Linear ENG-2: eng-2\nhttps://linear.app/t3/issue/eng-2");
  });
});
