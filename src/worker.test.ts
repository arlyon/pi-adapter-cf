import { describe, expect, it } from "vitest";
import type { AgentEnv, AgentWorkerConfig } from "./types.ts";
import { createWorkerHandler } from "./worker.ts";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockEnv(fetchImpl?: (req: Request) => Promise<Response>): AgentEnv {
	const doFetch = fetchImpl ?? (async () => Response.json({ forwarded: true }));
	const fakeId = {
		toString: () => "fake-do-id",
	};
	return {
		AGENT_SESSION: {
			newUniqueId: () => fakeId,
			idFromString: (id: string) => ({ toString: () => id }),
			idFromName: (name: string) => ({ toString: () => `name:${name}` }),
			get: () => ({ fetch: doFetch }),
		},
	} as unknown as AgentEnv;
}

function mockCtx(): ExecutionContext {
	return {
		waitUntil: () => {},
		passThroughOnException: () => {},
	} as unknown as ExecutionContext;
}

function minimalConfig(
	overrides: Partial<AgentWorkerConfig> = {},
): AgentWorkerConfig {
	return {
		systemPrompt: "test",
		getApiKey: () => "key",
		...overrides,
	} as AgentWorkerConfig;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CORS", () => {
	it("OPTIONS returns 204 with CORS headers", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/anything", { method: "OPTIONS" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(204);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(resp.headers.get("Access-Control-Allow-Methods")).toBeTruthy();
	});

	it("non-OPTIONS responses include CORS headers", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/health", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.headers.get("Access-Control-Allow-Origin")).toBe("*");
	});
});

describe("health endpoint", () => {
	it("GET /health returns ok", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/health", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
		const body = (await resp.json()) as any;
		expect(body.ok).toBe(true);
		expect(typeof body.timestamp).toBe("number");
	});
});

describe("authentication", () => {
	it("rejects with 401 when authenticate returns false", async () => {
		const handler = createWorkerHandler(
			minimalConfig({ authenticate: () => false }),
		);
		const resp = await handler.fetch(
			new Request("http://localhost/health", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(401);
	});

	it("allows through when authenticate returns true", async () => {
		const handler = createWorkerHandler(
			minimalConfig({ authenticate: () => true }),
		);
		const resp = await handler.fetch(
			new Request("http://localhost/health", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
	});

	it("allows through when no authenticate is configured", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/health", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
	});
});

describe("session creation", () => {
	it("POST /sessions creates a session", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/sessions", { method: "POST" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(201);
		const body = (await resp.json()) as any;
		expect(typeof body.sessionId).toBe("string");
		expect(typeof body.createdAt).toBe("number");
	});
});

describe("route matching", () => {
	it("unknown path returns 404", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/unknown", { method: "GET" }),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(404);
	});

	it("GET /sessions/:id/usage forwards to DO", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/sessions/test-id/usage", {
				method: "GET",
			}),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
		const body = await resp.json();
		expect(body).toEqual({ forwarded: true });
	});

	it("GET /sessions/:id/state forwards to DO", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/sessions/test-id/state", {
				method: "GET",
			}),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
	});

	it("DELETE /sessions/:id forwards to DO", async () => {
		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/sessions/test-id", {
				method: "DELETE",
			}),
			mockEnv(),
			mockCtx(),
		);
		expect(resp.status).toBe(200);
	});
});

describe("DO forwarding", () => {
	it("falls back to idFromName when idFromString throws", async () => {
		let usedName = false;
		const env = {
			AGENT_SESSION: {
				newUniqueId: () => ({ toString: () => "id" }),
				idFromString: () => {
					throw new Error("invalid id");
				},
				idFromName: (name: string) => {
					usedName = true;
					return { toString: () => `name:${name}` };
				},
				get: () => ({
					fetch: async () => Response.json({ ok: true }),
				}),
			},
		} as unknown as AgentEnv;

		const handler = createWorkerHandler(minimalConfig());
		const resp = await handler.fetch(
			new Request("http://localhost/sessions/my-session/usage", {
				method: "GET",
			}),
			env,
			mockCtx(),
		);
		expect(resp.status).toBe(200);
		expect(usedName).toBe(true);
	});
});
