/**
 * pi-agent-cf — Core type definitions and DI interfaces
 *
 * All public extension points for customizing agent behavior on CF Workers.
 */

import type { AgentTool, AgentEvent, AgentOptions, AgentMessage, StreamFn, ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { Model, Api, ImageContent } from "@earendil-works/pi-ai";

// ---------------------------------------------------------------------------
// Environment — Base env shape expected by the SDK
// ---------------------------------------------------------------------------

/**
 * Minimum Env bindings the SDK expects. Users extend this with their own.
 */
export interface AgentEnv {
  AGENT_SESSION: DurableObjectNamespace;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Agent Worker Configuration — the main DI surface
// ---------------------------------------------------------------------------

export interface AgentWorkerConfig<Env extends AgentEnv = AgentEnv, Ctx = void> {
  /**
   * System prompt for the agent.
   * Can be a static string or a function that receives the CF env.
   */
  systemPrompt: string | ((env: Env) => string);

  /**
   * Factory that returns the tools available to the agent.
   * Receives the CF env and optional session context.
   */
  tools?: (env: Env, ctx: Ctx) => AgentTool<any>[];

  /**
   * Default LLM model. If omitted the pi-ai default is used
   * (gemini-2.5-flash-lite-preview).
   */
  model?: Model<any>;

  /**
   * Resolve an API key for a given provider.
   * Typically reads from `env` secrets.
   */
  getApiKey: (provider: string, env: Env) => string | undefined | Promise<string | undefined>;

  /**
   * Optional custom stream function. Defaults to pi-ai `streamSimple`.
   * Swap this to route through Cloudflare AI Gateway, add logging, etc.
   */
  streamFn?: StreamFn;

  /**
   * Optional context transformation before sending to LLM.
   * E.g. summarise old messages, inject RAG context, etc.
   */
  transformContext?: AgentOptions["transformContext"];

  /**
   * Optional message format conversion (AgentMessage[] → LLM Message[]).
   */
  convertToLlm?: AgentOptions["convertToLlm"];

  /**
   * Default thinking level for the model.
   */
  thinkingLevel?: ThinkingLevel;

  /**
   * Global event hook — called for every AgentEvent in every session.
   * Useful for logging / analytics.
   */
  onEvent?: (sessionId: string, event: AgentEvent, env: Env, ctx: Ctx) => void | Promise<void>;

  /**
   * Authentication middleware.
   * Return `true` to allow the request, `false` to reject with 401.
   * If omitted all requests are allowed.
   */
  authenticate?: (request: Request, env: Env) => boolean | Promise<boolean>;

  /**
   * Extract per-session context from an incoming request.
   * The returned value is stored in DO storage and passed to `tools` and `onEvent`.
   * Called on each prompt request; the latest value is persisted.
   */
  extractSessionContext?: (request: Request, env: Env) => Ctx | Promise<Ctx>;

  /**
   * How long (ms) a Durable Object should stay alive after the last
   * WebSocket disconnects. After this the DO alarm fires and the agent
   * in-memory state is cleared (persisted state remains).
   * Default: 5 minutes.
   */
  maxSessionIdleMs?: number;

  /**
   * Maximum number of messages to persist per session.
   * Older messages are dropped on save. Default: 200.
   */
  maxPersistedMessages?: number;
}

// ---------------------------------------------------------------------------
// Serialisable subset of AgentState (for REST / WS state responses)
// ---------------------------------------------------------------------------

export interface SerializableAgentState {
  systemPrompt: string;
  modelId: string;
  modelProvider: string;
  thinkingLevel: ThinkingLevel;
  toolNames: string[];
  messages: AgentMessage[];
  isStreaming: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Session metadata (returned when listing / creating sessions)
// ---------------------------------------------------------------------------

export interface SessionInfo {
  sessionId: string;
  createdAt: number;
}
