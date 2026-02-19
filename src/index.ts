/**
 * pi-agent-cf — Public API
 *
 * Main entry point for the SDK. Import everything from here.
 *
 * @example
 * ```ts
 * import {
 *   createAgentWorker,
 *   type AgentWorkerConfig,
 *   type AgentEnv,
 *   type ClientMessage,
 *   type ServerMessage,
 * } from '@funtuantw/pi-agent-cf';
 * ```
 */

// ---- Factory (primary API) ----
export { createAgentWorker } from "./factory.js";
export type { AgentWorkerExports } from "./factory.js";

// ---- Types / DI interfaces ----
export type {
  AgentEnv,
  AgentWorkerConfig,
  SerializableAgentState,
  SessionInfo,
} from "./types.js";

// ---- Protocol (for custom client implementations) ----
export type { ClientMessage, ServerMessage } from "./protocol.js";
export { parseClientMessage, serializeServerMessage } from "./protocol.js";

// ---- Persistence (for advanced use) ----
export {
  saveMessages,
  loadMessages,
  deleteSession,
  hasPersistedSession,
} from "./session-persistence.js";

// ---- DO class factory (for advanced use) ----
export { createAgentSessionDOClass } from "./agent-session-do.js";

// ---- Router factory (for advanced use) ----
export { createWorkerHandler } from "./worker.js";

// ---- Re-export commonly needed pi-agent-core / pi-ai types ----
export type {
  AgentTool,
  AgentEvent,
  AgentMessage,
  AgentOptions,
} from "@mariozechner/pi-agent-core";

export type {
  Model,
  Api,
  ImageContent,
  Tool,
} from "@mariozechner/pi-ai";

export type {
  StreamFn,
  ThinkingLevel,
} from "@mariozechner/pi-agent-core";

// Re-export useful runtime functions from pi-ai
export { getModel } from "@mariozechner/pi-ai";
