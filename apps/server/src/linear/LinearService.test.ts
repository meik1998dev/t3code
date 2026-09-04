import { assert, describe, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as LinearService from "./LinearService.ts";

interface GraphqlCall {
  readonly authorization: string | undefined;
  readonly query: string;
  readonly variables: Record<string, unknown>;
}

function readCall(request: HttpClientRequest.HttpClientRequest): GraphqlCall {
  const body =
    request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "{}";
  const parsed = JSON.parse(body) as { query: string; variables: Record<string, unknown> };
  return {
    authorization: request.headers["authorization"],
    query: parsed.query,
    variables: parsed.variables,
  };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeLayer(input: {
  readonly respond: (call: GraphqlCall) => Response;
  readonly env?: Record<string, string>;
  readonly storedKey?: string;
}) {
  const secrets = new Map<string, Uint8Array>();
  if (input.storedKey !== undefined) {
    secrets.set(
      LinearService.LINEAR_API_KEY_SECRET_NAME,
      new TextEncoder().encode(input.storedKey),
    );
  }
  const calls: GraphqlCall[] = [];
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) => {
    const call = readCall(request);
    calls.push(call);
    return Effect.succeed(HttpClientResponse.fromWeb(request, input.respond(call)));
  });
  const layer = LinearService.layer.pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, HttpClient.make(execute))),
    Layer.provide(
      Layer.succeed(
        ServerSecretStore.ServerSecretStore,
        ServerSecretStore.ServerSecretStore.of({
          get: (name) => Effect.succeed(Option.fromNullishOr(secrets.get(name))),
          set: (name, value) =>
            Effect.sync(() => {
              secrets.set(name, value);
            }),
          create: (name, value) =>
            Effect.sync(() => {
              secrets.set(name, value);
            }),
          getOrCreateRandom: () => Effect.succeed(new Uint8Array()),
          remove: (name) =>
            Effect.sync(() => {
              secrets.delete(name);
            }),
        }),
      ),
    ),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: input.env ?? {} }))),
    Layer.provideMerge(NodeServices.layer),
  );
  return { layer, calls, secrets };
}

const viewerResponse = { data: { viewer: { name: "Meik", email: "meik@example.com" } } };

function issue(overrides: { id: string; type: string; updatedAt: string; identifier?: string }) {
  return {
    id: overrides.id,
    identifier: overrides.identifier ?? overrides.id.toUpperCase(),
    title: `Issue ${overrides.id}`,
    url: `https://linear.app/t3/issue/${overrides.id}`,
    branchName: `meik/${overrides.id}`,
    priority: 2,
    updatedAt: overrides.updatedAt,
    state: { name: overrides.type, type: overrides.type, color: "#000" },
  };
}

describe("LinearService", () => {
  it.effect("reports not configured without touching the network", () =>
    Effect.gen(function* () {
      const { layer, calls } = makeLayer({ respond: () => json(viewerResponse) });
      const status = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.getStatus),
        Effect.provide(layer),
      );
      assert.deepStrictEqual(status, { configured: false, viewer: null });
      assert.strictEqual(calls.length, 0);
    }),
  );

  it.effect("checks a new key against the viewer before storing it", () =>
    Effect.gen(function* () {
      const { layer, calls, secrets } = makeLayer({ respond: () => json(viewerResponse) });
      const status = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.setApiKey({ apiKey: "lin_api_123" })),
        Effect.provide(layer),
      );
      assert.deepStrictEqual(status, {
        configured: true,
        viewer: { name: "Meik", email: "meik@example.com" },
      });
      assert.strictEqual(calls[0]?.authorization, "lin_api_123");
      assert.strictEqual(
        new TextDecoder().decode(secrets.get(LinearService.LINEAR_API_KEY_SECRET_NAME)),
        "lin_api_123",
      );
    }),
  );

  it.effect("does not store a key Linear rejects", () =>
    Effect.gen(function* () {
      const { layer, secrets } = makeLayer({ respond: () => json({ error: "nope" }, 401) });
      const exit = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.setApiKey({ apiKey: "bad" })),
        Effect.provide(layer),
        Effect.exit,
      );
      assert.isTrue(Exit.isFailure(exit));
      assert.isFalse(secrets.has(LinearService.LINEAR_API_KEY_SECRET_NAME));
    }),
  );

  it.effect("removing the key clears the store", () =>
    Effect.gen(function* () {
      const { layer, secrets } = makeLayer({
        respond: () => json(viewerResponse),
        storedKey: "lin_api_old",
      });
      const status = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.setApiKey({ apiKey: null })),
        Effect.provide(layer),
      );
      assert.deepStrictEqual(status, { configured: false, viewer: null });
      assert.isFalse(secrets.has(LinearService.LINEAR_API_KEY_SECRET_NAME));
    }),
  );

  it.effect("prefers the environment variable over the stored key", () =>
    Effect.gen(function* () {
      const { layer, calls } = makeLayer({
        respond: () => json(viewerResponse),
        storedKey: "stored",
        env: { T3CODE_LINEAR_API_KEY: "from-env" },
      });
      yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.getStatus),
        Effect.provide(layer),
      );
      assert.strictEqual(calls[0]?.authorization, "from-env");
    }),
  );

  it.effect("lists my issues across pages, grouped by state and newest first", () =>
    Effect.gen(function* () {
      const { layer, calls } = makeLayer({
        storedKey: "key",
        respond: (call) => {
          if (call.variables.after === null) {
            return json({
              data: {
                issues: {
                  nodes: [
                    issue({ id: "a", type: "backlog", updatedAt: "2026-09-04T00:00:00.000Z" }),
                    issue({ id: "b", type: "started", updatedAt: "2026-09-01T00:00:00.000Z" }),
                  ],
                  pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
                },
              },
            });
          }
          return json({
            data: {
              issues: {
                nodes: [
                  issue({ id: "c", type: "started", updatedAt: "2026-09-03T00:00:00.000Z" }),
                  issue({ id: "d", type: "unstarted", updatedAt: "2026-09-02T00:00:00.000Z" }),
                  issue({ id: "e", type: "mystery", updatedAt: "2026-09-05T00:00:00.000Z" }),
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          });
        },
      });
      const result = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.listMyIssues),
        Effect.provide(layer),
      );
      assert.deepStrictEqual(
        result.issues.map((entry) => entry.id),
        ["c", "b", "d", "e", "a"],
      );
      assert.strictEqual(result.issues[3]?.state.type, "backlog");
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1]?.variables.after, "cursor-1");
    }),
  );

  it.effect("fails with not-configured when no key exists", () =>
    Effect.gen(function* () {
      const { layer } = makeLayer({ respond: () => json({}) });
      const error = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.listMyIssues),
        Effect.provide(layer),
        Effect.flip,
      );
      assert.strictEqual(error._tag, "LinearNotConfiguredError");
    }),
  );

  it.effect("returns an issue with oldest-first, capped, trimmed comments", () =>
    Effect.gen(function* () {
      const comments = Array.from({ length: 25 }, (_, index) => ({
        body: index === 24 ? "x".repeat(2500) : `comment ${index}`,
        createdAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        user: index % 2 === 0 ? { name: "Hanaa" } : null,
        botActor: index % 2 === 0 ? null : { name: "Linear Bot" },
      })).toReversed();
      const { layer } = makeLayer({
        storedKey: "key",
        respond: () =>
          json({
            data: {
              issue: {
                ...issue({ id: "a", type: "started", updatedAt: "2026-09-01T00:00:00.000Z" }),
                description: "Do the thing",
                comments: { nodes: comments },
              },
            },
          }),
      });
      const detail = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.getIssue({ issueId: "a" })),
        Effect.provide(layer),
      );
      assert.strictEqual(detail.description, "Do the thing");
      assert.strictEqual(detail.comments.length, LinearService.ISSUE_COMMENT_LIMIT);
      assert.strictEqual(detail.comments[0]?.body, "comment 5");
      assert.strictEqual(detail.comments[0]?.author, "Linear Bot");
      const last = detail.comments.at(-1);
      assert.strictEqual(last?.body.length, LinearService.ISSUE_COMMENT_BODY_LIMIT + 1);
      assert.isTrue(last?.body.endsWith("…"));
    }),
  );

  it.effect("surfaces GraphQL errors as request errors", () =>
    Effect.gen(function* () {
      const { layer } = makeLayer({
        storedKey: "key",
        respond: () => json({ data: null, errors: [{ message: "Entity not found" }] }),
      });
      const error = yield* LinearService.LinearService.pipe(
        Effect.flatMap((service) => service.getIssue({ issueId: "missing" })),
        Effect.provide(layer),
        Effect.flip,
      );
      assert.strictEqual(error._tag, "LinearRequestError");
      assert.strictEqual(error.message, "Entity not found");
    }),
  );
});
