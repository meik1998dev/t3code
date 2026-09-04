/**
 * Linear API access for the environment. Holds one personal API key in the
 * secret store (or reads `T3CODE_LINEAR_API_KEY`) and answers the small set
 * of reads the composer needs: who am I, my open issues, one issue with its
 * comments.
 *
 * @module linear/LinearService
 */
import {
  LinearIssueStateType,
  LinearNotConfiguredError,
  LinearRequestError,
  sortLinearIssues,
  type LinearIssueComment,
  type LinearIssueDetail,
  type LinearIssueSummary,
  type LinearListMyIssuesResult,
  type LinearSetApiKeyInput,
  type LinearStatus,
  type LinearViewer,
} from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";

export const LINEAR_API_KEY_SECRET_NAME = "linear-api-key";
const DEFAULT_GRAPHQL_URL = "https://api.linear.app/graphql";
/** One page per request; Linear allows up to 250 but 100 keeps responses small. */
const ISSUES_PAGE_SIZE = 100;
/** Five pages is 500 open issues assigned to one person. Past that, search in Linear. */
const ISSUES_MAX_PAGES = 5;
export const ISSUE_COMMENT_LIMIT = 20;
export const ISSUE_COMMENT_BODY_LIMIT = 2000;
export const ISSUE_DESCRIPTION_LIMIT = 20_000;

const LinearEnvConfig = Config.all({
  graphqlUrl: Config.string("T3CODE_LINEAR_GRAPHQL_URL").pipe(
    Config.withDefault(DEFAULT_GRAPHQL_URL),
  ),
  apiKey: Config.string("T3CODE_LINEAR_API_KEY").pipe(Config.option),
});

export type LinearServiceError = LinearNotConfiguredError | LinearRequestError;

export class LinearService extends Context.Service<
  LinearService,
  {
    readonly getStatus: Effect.Effect<LinearStatus, LinearServiceError>;
    readonly setApiKey: (
      input: LinearSetApiKeyInput,
    ) => Effect.Effect<LinearStatus, LinearServiceError>;
    readonly listMyIssues: Effect.Effect<LinearListMyIssuesResult, LinearServiceError>;
    readonly getIssue: (input: {
      readonly issueId: string;
    }) => Effect.Effect<LinearIssueDetail, LinearServiceError>;
  }
>()("t3/linear/LinearService") {}

// -----------------------------------------------------------------------------
// GraphQL wire schemas. Only the fields the app reads; Linear may send more.
// -----------------------------------------------------------------------------

const GraphqlErrors = Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String })));

const WireViewer = Schema.Struct({
  name: Schema.String,
  email: Schema.NullOr(Schema.String),
});

const WireIssueState = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  color: Schema.String,
});

const WireIssueSummary = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  title: Schema.String,
  url: Schema.String,
  branchName: Schema.NullOr(Schema.String),
  priority: Schema.Number,
  updatedAt: Schema.String,
  state: WireIssueState,
});

const WireComment = Schema.Struct({
  body: Schema.String,
  createdAt: Schema.String,
  user: Schema.NullOr(Schema.Struct({ name: Schema.String })),
  botActor: Schema.NullOr(Schema.Struct({ name: Schema.String })),
});

const ViewerResponse = Schema.Struct({
  data: Schema.NullOr(Schema.Struct({ viewer: WireViewer })),
  errors: GraphqlErrors,
});

const IssuesResponse = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      issues: Schema.Struct({
        nodes: Schema.Array(WireIssueSummary),
        pageInfo: Schema.Struct({
          hasNextPage: Schema.Boolean,
          endCursor: Schema.NullOr(Schema.String),
        }),
      }),
    }),
  ),
  errors: GraphqlErrors,
});

const IssueResponse = Schema.Struct({
  data: Schema.NullOr(
    Schema.Struct({
      issue: Schema.NullOr(
        Schema.Struct({
          ...WireIssueSummary.fields,
          description: Schema.NullOr(Schema.String),
          comments: Schema.Struct({ nodes: Schema.Array(WireComment) }),
        }),
      ),
    }),
  ),
  errors: GraphqlErrors,
});

const VIEWER_QUERY = `query T3Viewer { viewer { name email } }`;

const MY_ISSUES_QUERY = `query T3MyIssues($first: Int!, $after: String) {
  issues(
    first: $first
    after: $after
    orderBy: updatedAt
    filter: {
      assignee: { isMe: { eq: true } }
      state: { type: { nin: ["completed", "canceled"] } }
    }
  ) {
    nodes { id identifier title url branchName priority updatedAt state { name type color } }
    pageInfo { hasNextPage endCursor }
  }
}`;

const ISSUE_QUERY = `query T3Issue($id: String!, $comments: Int!) {
  issue(id: $id) {
    id identifier title url branchName priority updatedAt description
    state { name type color }
    comments(first: $comments, orderBy: createdAt) {
      nodes { body createdAt user { name } botActor { name } }
    }
  }
}`;

const isStateType = Schema.is(LinearIssueStateType);

function toIssueSummary(issue: typeof WireIssueSummary.Type): LinearIssueSummary {
  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    url: issue.url,
    branchName: issue.branchName,
    priority: Math.trunc(issue.priority),
    updatedAt: issue.updatedAt,
    state: {
      name: issue.state.name,
      // Unknown state types from a newer Linear API read as backlog: listed last, never dropped.
      type: isStateType(issue.state.type) ? issue.state.type : "backlog",
      color: issue.state.color,
    },
  };
}

/** Oldest first, most recent `ISSUE_COMMENT_LIMIT` only, long bodies cut. */
export function toIssueComments(
  comments: ReadonlyArray<typeof WireComment.Type>,
): ReadonlyArray<LinearIssueComment> {
  return [...comments]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-ISSUE_COMMENT_LIMIT)
    .map((comment) => ({
      author: comment.user?.name ?? comment.botActor?.name ?? null,
      createdAt: comment.createdAt,
      body: truncate(comment.body, ISSUE_COMMENT_BODY_LIMIT),
    }));
}

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

export const make = Effect.gen(function* () {
  const config = yield* LinearEnvConfig;
  const httpClient = yield* HttpClient.HttpClient;
  const secretStore = yield* ServerSecretStore.ServerSecretStore;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();

  const requestError = (
    operation: string,
    detail: string,
    extra?: { status?: number; cause?: unknown },
  ) =>
    new LinearRequestError({
      operation,
      detail,
      ...(extra?.status === undefined ? {} : { status: extra.status }),
      ...(extra?.cause === undefined ? {} : { cause: extra.cause }),
    });

  const readStoredApiKey = Effect.gen(function* () {
    if (Option.isSome(config.apiKey)) {
      return Option.some(config.apiKey.value);
    }
    const secret = yield* secretStore
      .get(LINEAR_API_KEY_SECRET_NAME)
      .pipe(
        Effect.mapError((cause) =>
          requestError("read-key", "Could not read the stored Linear API key.", { cause }),
        ),
      );
    return Option.map(secret, (bytes) => textDecoder.decode(bytes));
  });

  const graphql = <S extends Schema.Top>(
    operation: string,
    apiKey: string,
    query: string,
    variables: Record<string, unknown>,
    schema: S,
  ): Effect.Effect<S["Type"], LinearRequestError, S["DecodingServices"]> =>
    httpClient
      .execute(
        HttpClientRequest.post(config.graphqlUrl).pipe(
          // Personal API keys are sent as-is; only OAuth tokens use the Bearer prefix.
          HttpClientRequest.setHeader("Authorization", apiKey),
          HttpClientRequest.acceptJson,
          HttpClientRequest.bodyJsonUnsafe({ query, variables }),
        ),
      )
      .pipe(
        Effect.mapError((cause) => requestError(operation, "Could not reach Linear.", { cause })),
        Effect.flatMap((response) =>
          HttpClientResponse.matchStatus({
            "2xx": (success) =>
              HttpClientResponse.schemaBodyJson(schema)(success).pipe(
                Effect.mapError((cause) =>
                  requestError(operation, "Linear sent a response the app could not read.", {
                    status: success.status,
                    cause,
                  }),
                ),
              ),
            orElse: (failed) =>
              Effect.fail(
                requestError(
                  operation,
                  failed.status === 401 || failed.status === 400
                    ? "Linear rejected the API key."
                    : failed.status === 429
                      ? "Linear rate limit reached. Try again in a minute."
                      : `Linear answered with status ${failed.status}.`,
                  { status: failed.status },
                ),
              ),
          })(response),
        ),
      );

  const failOnGraphqlErrors = (
    operation: string,
    errors: ReadonlyArray<{ readonly message: string }> | undefined,
  ) =>
    errors && errors.length > 0
      ? Effect.fail(requestError(operation, errors[0]?.message ?? "Linear reported an error."))
      : Effect.void;

  const fetchViewer = (apiKey: string): Effect.Effect<LinearViewer, LinearRequestError> =>
    Effect.gen(function* () {
      const response = yield* graphql("viewer", apiKey, VIEWER_QUERY, {}, ViewerResponse);
      yield* failOnGraphqlErrors("viewer", response.errors);
      if (!response.data) {
        return yield* requestError("viewer", "Linear rejected the API key.");
      }
      return { name: response.data.viewer.name, email: response.data.viewer.email };
    });

  const requireApiKey = readStoredApiKey.pipe(
    Effect.flatMap((apiKey) =>
      Option.isSome(apiKey)
        ? Effect.succeed(apiKey.value)
        : Effect.fail(new LinearNotConfiguredError()),
    ),
  );

  const getStatus: Effect.Effect<LinearStatus, LinearServiceError> = Effect.gen(function* () {
    const apiKey = yield* readStoredApiKey;
    if (Option.isNone(apiKey)) {
      return { configured: false, viewer: null };
    }
    const viewer = yield* fetchViewer(apiKey.value);
    return { configured: true, viewer };
  });

  const setApiKey = Effect.fn("LinearService.setApiKey")(function* (input: LinearSetApiKeyInput) {
    if (input.apiKey === null) {
      yield* secretStore
        .remove(LINEAR_API_KEY_SECRET_NAME)
        .pipe(
          Effect.mapError((cause) =>
            requestError("remove-key", "Could not remove the Linear API key.", { cause }),
          ),
        );
      return { configured: false, viewer: null } satisfies LinearStatus;
    }
    // Check the key before storing it so a typo never lands in the secret store.
    const viewer = yield* fetchViewer(input.apiKey);
    yield* secretStore
      .set(LINEAR_API_KEY_SECRET_NAME, textEncoder.encode(input.apiKey))
      .pipe(
        Effect.mapError((cause) =>
          requestError("write-key", "Could not store the Linear API key.", { cause }),
        ),
      );
    return { configured: true, viewer } satisfies LinearStatus;
  });

  const listMyIssues: Effect.Effect<LinearListMyIssuesResult, LinearServiceError> = Effect.gen(
    function* () {
      const apiKey = yield* requireApiKey;
      const issues: LinearIssueSummary[] = [];
      let after: string | null = null;
      for (let page = 0; page < ISSUES_MAX_PAGES; page += 1) {
        const response: typeof IssuesResponse.Type = yield* graphql(
          "list-issues",
          apiKey,
          MY_ISSUES_QUERY,
          { first: ISSUES_PAGE_SIZE, after },
          IssuesResponse,
        );
        yield* failOnGraphqlErrors("list-issues", response.errors);
        if (!response.data) break;
        for (const issue of response.data.issues.nodes) {
          issues.push(toIssueSummary(issue));
        }
        const pageInfo = response.data.issues.pageInfo;
        if (!pageInfo.hasNextPage || pageInfo.endCursor === null) break;
        after = pageInfo.endCursor;
      }
      return { issues: sortLinearIssues(issues) };
    },
  );

  const getIssue = Effect.fn("LinearService.getIssue")(function* (input: {
    readonly issueId: string;
  }) {
    const apiKey = yield* requireApiKey;
    const response = yield* graphql(
      "get-issue",
      apiKey,
      ISSUE_QUERY,
      { id: input.issueId, comments: ISSUE_COMMENT_LIMIT },
      IssueResponse,
    );
    yield* failOnGraphqlErrors("get-issue", response.errors);
    const issue = response.data?.issue ?? null;
    if (issue === null) {
      return yield* requestError(
        "get-issue",
        "That Linear issue no longer exists or is not visible to you.",
      );
    }
    return {
      ...toIssueSummary(issue),
      description:
        issue.description === null ? null : truncate(issue.description, ISSUE_DESCRIPTION_LIMIT),
      comments: toIssueComments(issue.comments.nodes),
    } satisfies LinearIssueDetail;
  });

  return LinearService.of({ getStatus, setApiKey, listMyIssues, getIssue });
});

export const layer = Layer.effect(LinearService, make);

/** Not connected, for suites that only need the RPC surface to resolve. */
export const layerTest = Layer.succeed(
  LinearService,
  LinearService.of({
    getStatus: Effect.succeed({ configured: false, viewer: null }),
    setApiKey: () => Effect.succeed({ configured: false, viewer: null }),
    listMyIssues: Effect.fail(new LinearNotConfiguredError()),
    getIssue: () => Effect.fail(new LinearNotConfiguredError()),
  }),
);
