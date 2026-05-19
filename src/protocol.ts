/**
 * pi-agent-cf — WebSocket message protocol
 *
 * JSON-based bidirectional messages between client and AgentSession DO.
 */

import type { AgentMessage, AgentEvent } from "@earendil-works/pi-agent-core";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type { SerializableAgentState } from "./types.js";

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: "prompt"; text: string; images?: ImageContent[] }
  | { type: "steer"; message: AgentMessage }
  | { type: "follow_up"; message: AgentMessage }
  | { type: "abort" }
  | { type: "get_state" }
  | { type: "set_model"; provider: string; modelId: string }
  | { type: "set_thinking_level"; level: ThinkingLevel }
  | { type: "clear_messages" }
  | { type: "reset" }
  | { type: "restore" }
  | { type: "ping" };

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: "event"; event: AgentEvent }
  | { type: "state"; state: SerializableAgentState }
  | { type: "restored"; messages: AgentMessage[] }
  | { type: "error"; message: string; code?: string }
  | { type: "session_created"; sessionId: string }
  | { type: "pong" };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.type === "string") {
      return parsed as ClientMessage;
    }
    return null;
  } catch {
    return null;
  }
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg);
}
