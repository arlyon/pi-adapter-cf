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
 * } from 'pi-adapter-cf';
 * ```
 */

// ---- Re-export commonly needed pi-agent-core / pi-ai types ----
export type {
	AgentEvent,
	AgentMessage,
	AgentOptions,
	AgentTool,
	SessionMetadata,
	SessionStorage,
	SessionTreeEntry,
	StreamFn,
	ThinkingLevel,
} from "@earendil-works/pi-agent-core";
export { Session } from "@earendil-works/pi-agent-core";
export type {
	Api,
	ImageContent,
	Model,
	Tool,
} from "@earendil-works/pi-ai";
// Re-export useful runtime functions from pi-ai
export { getModel } from "@earendil-works/pi-ai";
// ---- DO class factory (for advanced use) ----
export { createAgentSessionDOClass } from "./agent-session-do.ts";
// ---- Session storage ----
export { DOSessionStorage } from "./do-session-storage.ts";
export type { AgentWorkerExports } from "./factory.ts";
// ---- Factory (primary API) ----
export { createAgentWorker } from "./factory.ts";
// ---- Protocol (for custom client implementations) ----
export type { ClientMessage, ServerMessage } from "./protocol.ts";
export { parseClientMessage, serializeServerMessage } from "./protocol.ts";
// ---- Persistence (for advanced use) ----
export {
	deleteSession,
	hasPersistedSession,
	loadMessages,
	saveMessages,
} from "./session-persistence.ts";
// ---- Types / DI interfaces ----
export type {
	AgentEnv,
	AgentWorkerConfig,
	SerializableAgentState,
	SessionInfo,
} from "./types.ts";
// ---- Router factory (for advanced use) ----
export { createWorkerHandler } from "./worker.ts";
