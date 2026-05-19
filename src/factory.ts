/**
 * pi-agent-cf — Factory function
 *
 * The primary public API. Creates everything needed for a CF Worker deployment:
 *  - A Durable Object class (to export)
 *  - A fetch handler (to export as default)
 *
 * Usage:
 * ```ts
 * import { createAgentWorker } from 'pi-adapter-cf';
 *
 * const worker = createAgentWorker({
 *   systemPrompt: 'You are a helpful assistant.',
 *   getApiKey: (provider, env) => env[`${provider.toUpperCase()}_API_KEY`] as string,
 *   tools: (env) => [myTool],
 * });
 *
 * // Export for wrangler
 * export const AgentSessionDO = worker.AgentSessionDO;
 * export default worker.handler;
 * ```
 */

import type { AgentEnv, AgentWorkerConfig } from "./types.js";
import { createAgentSessionDOClass } from "./agent-session-do.js";
import { createWorkerHandler } from "./worker.js";

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface AgentWorkerExports<Env extends AgentEnv> {
  /**
   * The Durable Object class to export from your worker module.
   * Must be referenced in `wrangler.toml` under `[durable_objects.bindings]`.
   */
  AgentSessionDO: ReturnType<typeof createAgentSessionDOClass<Env, any>>;

  /**
   * The worker fetch handler. Export as `default`.
   *
   * Handles:
   *  - POST /sessions                → create session
   *  - GET  /sessions/:id/ws         → WebSocket upgrade
   *  - GET  /sessions/:id/state      → REST state query
   *  - POST /sessions/:id/prompt     → REST prompt
   *  - DELETE /sessions/:id          → delete session
   *  - GET  /health                  → health check
   */
  handler: ExportedHandler<Env>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a complete Cloudflare Worker + Durable Object setup for an AI agent.
 *
 * @param config  DI configuration — system prompt, tools, API keys, etc.
 * @returns       `{ AgentSessionDO, handler }` ready to export.
 */
export function createAgentWorker<Env extends AgentEnv = AgentEnv, Ctx = void>(
  config: AgentWorkerConfig<Env, Ctx>,
): AgentWorkerExports<Env> {
  const AgentSessionDO = createAgentSessionDOClass<Env, Ctx>(config);
  const router = createWorkerHandler<Env, Ctx>(config);

  return {
    AgentSessionDO,
    handler: {
      fetch: router.fetch,
    },
  };
}
