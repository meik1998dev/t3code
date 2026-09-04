/**
 * Linear integration contracts. The server holds the API key; clients only
 * see issue data and a "connected as" status.
 *
 * @module linear
 */
import * as Schema from "effect/Schema";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const LinearIssueStateType = Schema.Literals([
  "triage",
  "backlog",
  "unstarted",
  "started",
  "completed",
  "canceled",
]);
export type LinearIssueStateType = typeof LinearIssueStateType.Type;

export const LinearIssueState = Schema.Struct({
  name: Schema.String,
  type: LinearIssueStateType,
  color: Schema.String,
});
export type LinearIssueState = typeof LinearIssueState.Type;

export const LinearIssueSummary = Schema.Struct({
  id: Schema.String,
  /** Human key such as `ENG-123`. */
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  /** Linear's suggested git branch name for the issue, when the workspace has one. */
  branchName: Schema.NullOr(Schema.String),
  /** 0 = none, 1 = urgent, 4 = low. */
  priority: Schema.Int,
  updatedAt: IsoDateTime,
  state: LinearIssueState,
});
export type LinearIssueSummary = typeof LinearIssueSummary.Type;

export const LinearIssueComment = Schema.Struct({
  author: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  body: Schema.String,
});
export type LinearIssueComment = typeof LinearIssueComment.Type;

export const LinearIssueDetail = Schema.Struct({
  ...LinearIssueSummary.fields,
  description: Schema.NullOr(Schema.String),
  /** Oldest first. The server caps the count and the length of each body. */
  comments: Schema.Array(LinearIssueComment),
});
export type LinearIssueDetail = typeof LinearIssueDetail.Type;

export const LinearViewer = Schema.Struct({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
});
export type LinearViewer = typeof LinearViewer.Type;

export const LinearStatus = Schema.Struct({
  /** True when an API key is stored on this environment. */
  configured: Schema.Boolean,
  /** The account the key belongs to. Null when not configured. */
  viewer: Schema.NullOr(LinearViewer),
});
export type LinearStatus = typeof LinearStatus.Type;

export const LinearSetApiKeyInput = Schema.Struct({
  /** Null removes the stored key. */
  apiKey: Schema.NullOr(TrimmedNonEmptyString),
});
export type LinearSetApiKeyInput = typeof LinearSetApiKeyInput.Type;

export const LinearGetIssueInput = Schema.Struct({
  issueId: TrimmedNonEmptyString,
});
export type LinearGetIssueInput = typeof LinearGetIssueInput.Type;

export const LinearListMyIssuesResult = Schema.Struct({
  issues: Schema.Array(LinearIssueSummary),
});
export type LinearListMyIssuesResult = typeof LinearListMyIssuesResult.Type;

export class LinearNotConfiguredError extends Schema.TaggedErrorClass<LinearNotConfiguredError>()(
  "LinearNotConfiguredError",
  {},
) {
  override get message(): string {
    return "Linear is not connected. Add an API key in Settings → Integrations.";
  }
}

export class LinearRequestError extends Schema.TaggedErrorClass<LinearRequestError>()(
  "LinearRequestError",
  {
    operation: Schema.String,
    detail: TrimmedNonEmptyString,
    status: Schema.optional(Schema.Int),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export const LinearRpcError = Schema.Union([LinearNotConfiguredError, LinearRequestError]);
export type LinearRpcError = typeof LinearRpcError.Type;

// -----------------------------------------------------------------------------
// Small derived helpers shared by every client
// -----------------------------------------------------------------------------

/** Active work first, then queued, then triage and backlog. Done work is not listed. */
const LINEAR_STATE_ORDER: Readonly<Record<LinearIssueStateType, number>> = {
  started: 0,
  unstarted: 1,
  triage: 2,
  backlog: 3,
  completed: 4,
  canceled: 5,
};

/** Groups by state type, newest update first inside a group. */
export function sortLinearIssues(
  issues: ReadonlyArray<LinearIssueSummary>,
): ReadonlyArray<LinearIssueSummary> {
  return [...issues].sort((left, right) => {
    const stateDelta = LINEAR_STATE_ORDER[left.state.type] - LINEAR_STATE_ORDER[right.state.type];
    if (stateDelta !== 0) return stateDelta;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

/** The text placed in the composer when an issue is picked. */
export function buildLinearIssuePrompt(issue: LinearIssueDetail): string {
  const lines: string[] = [`Linear ${issue.identifier}: ${issue.title}`, issue.url];
  const description = issue.description?.trim();
  if (description) {
    lines.push("", description);
  }
  if (issue.comments.length > 0) {
    lines.push("", "## Comments");
    for (const comment of issue.comments) {
      const day = comment.createdAt.slice(0, 10);
      const author = comment.author ?? "Unknown";
      lines.push(`- **${author}**, ${day}: ${comment.body.trim()}`);
    }
  }
  return lines.join("\n");
}
