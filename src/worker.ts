/**
 * pi-agent-cf — Worker HTTP router
 *
 * Creates a fetch handler that:
 *  1. Authenticates requests (if configured)
 *  2. Routes session management (create / delete / list)
 *  3. Forwards WebSocket upgrades and REST calls to the correct DO
 */

import type { AgentEnv, AgentWorkerConfig, SessionInfo } from "./types.js";

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

export function createWorkerHandler<Env extends AgentEnv>(
  config: AgentWorkerConfig<Env>,
) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      // ---- CORS preflight ----
      if (request.method === "OPTIONS") {
        return handleCors(request);
      }

      // ---- Authentication ----
      if (config.authenticate) {
        const allowed = await config.authenticate(request, env);
        if (!allowed) {
          return cors(request, new Response("Unauthorized", { status: 401 }));
        }
      }

      const url = new URL(request.url);
      const path = url.pathname;

      // ---- Routes ----

      // POST /sessions — create a new session
      if (request.method === "POST" && path === "/sessions") {
        return cors(request, await handleCreateSession(env));
      }

      // GET /sessions/:id/ws — WebSocket upgrade → forward to DO
      const wsMatch = path.match(/^\/sessions\/([^/]+)\/ws$/);
      if (wsMatch && request.headers.get("Upgrade") === "websocket") {
        const sessionId = wsMatch[1];
        return forwardToDO(env, sessionId, request);
      }

      // GET /sessions/:id/state — REST state query
      const stateMatch = path.match(/^\/sessions\/([^/]+)\/state$/);
      if (stateMatch && request.method === "GET") {
        const sessionId = stateMatch[1];
        const resp = await forwardToDO(env, sessionId, new Request(
          new URL(`/state`, request.url),
          { method: "GET" },
        ));
        return cors(request, resp);
      }

      // POST /sessions/:id/prompt — REST prompt (fire-and-forget)
      const promptMatch = path.match(/^\/sessions\/([^/]+)\/prompt$/);
      if (promptMatch && request.method === "POST") {
        const sessionId = promptMatch[1];
        const resp = await forwardToDO(env, sessionId, new Request(
          new URL(`/prompt`, request.url),
          { method: "POST", body: request.body, headers: request.headers },
        ));
        return cors(request, resp);
      }

      // DELETE /sessions/:id — delete session
      const deleteMatch = path.match(/^\/sessions\/([^/]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        const sessionId = deleteMatch[1];
        const resp = await forwardToDO(env, sessionId, new Request(
          new URL(`/`, request.url),
          { method: "DELETE" },
        ));
        return cors(request, resp);
      }

      // GET /health
      if (path === "/health" && request.method === "GET") {
        return cors(request, Response.json({ ok: true, timestamp: Date.now() }));
      }

      return cors(request, new Response("Not found", { status: 404 }));
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function handleCreateSession<Env extends AgentEnv>(env: Env): Promise<Response> {
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
