/**
 * pi-agent-cf — Worker HTTP router
 *
 * Creates a fetch handler that:
 *  1. Authenticates requests (if configured)
 *  2. Routes session management (create / delete / list)
 *  3. Forwards WebSocket upgrades and REST calls to the correct DO
 */

import type { AgentEnv, AgentWorkerConfig, SessionInfo } from "./types.ts";

// ---------------------------------------------------------------------------
// Session route table
// ---------------------------------------------------------------------------

interface SessionRoute {
	action: string;
	method: string;
	forwardBody?: boolean;
}

const SESSION_ROUTES: SessionRoute[] = [
	{ action: "state", method: "GET" },
	{ action: "usage", method: "GET" },
	{ action: "entries", method: "GET" },
	{ action: "branch", method: "GET" },
	{ action: "prompt", method: "POST", forwardBody: true },
	{ action: "label", method: "POST", forwardBody: true },
	{ action: "navigate", method: "POST", forwardBody: true },
];

const SESSION_PATH_RE = /^\/sessions\/([^/]+)(?:\/(\w+))?$/;

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createWorkerHandler<Env extends AgentEnv, Ctx = void>(
	config: AgentWorkerConfig<Env, Ctx>,
) {
	return {
		async fetch(
			request: Request,
			env: Env,
			_ctx: ExecutionContext,
		): Promise<Response> {
			if (request.method === "OPTIONS") {
				return handleCors(request);
			}

			if (config.authenticate) {
				const allowed = await config.authenticate(request, env);
				if (!allowed) {
					return cors(request, new Response("Unauthorized", { status: 401 }));
				}
			}

			const resp = await routeRequest(request, env);
			return resp;
		},
	};
}

// ---------------------------------------------------------------------------
// Route dispatch
// ---------------------------------------------------------------------------

async function routeRequest<Env extends AgentEnv>(
	request: Request,
	env: Env,
): Promise<Response> {
	const path = new URL(request.url).pathname;

	if (request.method === "POST" && path === "/sessions") {
		return cors(request, await handleCreateSession(env));
	}

	if (path === "/health" && request.method === "GET") {
		return cors(request, Response.json({ ok: true, timestamp: Date.now() }));
	}

	const match = path.match(SESSION_PATH_RE);
	if (!match) {
		return cors(request, new Response("Not found", { status: 404 }));
	}

	const resp = await routeSessionRequest(request, env, match[1], match[2]);
	return cors(request, resp);
}

async function routeSessionRequest<Env extends AgentEnv>(
	request: Request,
	env: Env,
	sessionId: string,
	action: string | undefined,
): Promise<Response> {
	// WebSocket upgrade
	if (action === "ws" && request.headers.get("Upgrade") === "websocket") {
		return forwardToDO(env, sessionId, request);
	}

	// DELETE /sessions/:id
	if (!action && request.method === "DELETE") {
		return forwardToDO(
			env,
			sessionId,
			new Request(new URL("/", request.url), { method: "DELETE" }),
		);
	}

	// Table-driven session routes
	const route = SESSION_ROUTES.find(
		(r) => r.action === action && r.method === request.method,
	);
	if (!route) {
		return new Response("Not found", { status: 404 });
	}

	return forwardToDO(
		env,
		sessionId,
		buildDORequest(request, `/${action}`, route.forwardBody),
	);
}

function buildDORequest(
	request: Request,
	doPath: string,
	forwardBody?: boolean,
): Request {
	if (forwardBody) {
		return new Request(new URL(doPath, request.url), {
			method: request.method,
			body: request.body,
			headers: request.headers,
			duplex: "half",
		} as RequestInit);
	}
	return new Request(new URL(doPath, request.url), { method: "GET" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handleCreateSession<Env extends AgentEnv>(
	env: Env,
): Promise<Response> {
	const id = env.AGENT_SESSION.newUniqueId();
	const info: SessionInfo = {
		sessionId: id.toString(),
		createdAt: Date.now(),
	};
	return Response.json(info, { status: 201 });
}

function forwardToDO<Env extends AgentEnv>(
	env: Env,
	sessionId: string,
	request: Request,
): Promise<Response> {
	let id: DurableObjectId;
	try {
		// Try to parse as an existing DO id first
		id = env.AGENT_SESSION.idFromString(sessionId);
	} catch {
		// Fall back to name-based id (allows user-friendly session names)
		id = env.AGENT_SESSION.idFromName(sessionId);
	}
	const stub = env.AGENT_SESSION.get(id);
	return stub.fetch(request);
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

const CORS_HEADERS: Record<string, string> = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
};

function handleCors(_request: Request): Response {
	return new Response(null, { status: 204, headers: CORS_HEADERS });
}

function cors(_request: Request, response: Response): Response {
	const newResp = new Response(response.body, response);
	for (const [k, v] of Object.entries(CORS_HEADERS)) {
		newResp.headers.set(k, v);
	}
	return newResp;
}
