/**
 * Example: Deploy a pi-mono agent on Cloudflare Workers
 *
 * This demonstrates how to use pi-agent-cf to stand up an AI agent
 * with custom tools, accessible via WebSocket or REST API.
 *
 * Deploy:
 *   wrangler secret put GOOGLE_API_KEY
 *   wrangler deploy --config example/wrangler.toml
 *
 * Connect:
 *   1. POST /sessions → get { sessionId }
 *   2. WS   /sessions/:id/ws → send { type: "prompt", text: "Hello!" }
 */

import { createAgentWorker, type AgentEnv, type AgentTool } from "../../src/index.js";
import { Type, type Static } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Environment — extend AgentEnv with your custom bindings / secrets
// ---------------------------------------------------------------------------

interface Env extends AgentEnv {
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

// ---------------------------------------------------------------------------
// Custom tools — these run inside the Durable Object on CF Workers
// ---------------------------------------------------------------------------

const GetCurrentTimeSchema = Type.Object({});

const GetCurrentTime: AgentTool<typeof GetCurrentTimeSchema> = {
  name: "get_current_time",
  label: "Get Current Time",
  description: "Returns the current UTC date and time.",
  parameters: GetCurrentTimeSchema,
  execute: async () => ({
    content: [{ type: "text", text: new Date().toISOString() }],
    details: null,
  }),
};

const CalculateSchema = Type.Object({
  expression: Type.String({ description: "A mathematical expression to evaluate, e.g. '2 + 3 * 4'" }),
});

const Calculate: AgentTool<typeof CalculateSchema> = {
  name: "calculate",
  label: "Calculator",
  description: "Evaluates a simple mathematical expression and returns the result.",
  parameters: CalculateSchema,
  execute: async (_toolCallId, params) => {
    try {
      // Simple safe math eval (no eval() — just basic arithmetic)
      const result = safeEval(params.expression);
      return {
        content: [{ type: "text", text: `${params.expression} = ${result}` }],
        details: { result },
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error: ${e.message}` }],
        details: { error: e.message },
      };
    }
  },
};

function safeEval(expr: string): number {
  // Very basic arithmetic: supports +, -, *, /, parentheses, decimals
  const sanitised = expr.replace(/[^0-9+\-*/().  ]/g, "");
  if (sanitised !== expr.trim()) {
    throw new Error("Expression contains invalid characters");
  }
  // Use Function constructor for simple math (runs in V8 isolate — safe in Workers)
  return new Function(`"use strict"; return (${sanitised});`)() as number;
}

// ---------------------------------------------------------------------------
// Create the worker
// ---------------------------------------------------------------------------

const worker = createAgentWorker<Env>({
  systemPrompt: `You are a helpful AI assistant running on Cloudflare Workers.
You have access to tools for getting the current time and doing calculations.
Be concise and helpful.`,

  tools: (_env) => [GetCurrentTime, Calculate],

  getApiKey: (provider, env) => {
    const map: Record<string, string | undefined> = {
      google: env.GOOGLE_API_KEY,
      openai: env.OPENAI_API_KEY,
      anthropic: env.ANTHROPIC_API_KEY,
    };
    return map[provider];
  },

  // Optional: log all events
  onEvent: (sessionId, event, _env) => {
    if (event.type === "agent_start" || event.type === "agent_end") {
      console.log(`[${sessionId}] ${event.type}`);
    }
  },

  // Optional: simple bearer token auth
  // authenticate: async (request, env) => {
  //   const auth = request.headers.get('Authorization');
  //   return auth === `Bearer ${env.AUTH_TOKEN}`;
  // },
});

// ---------------------------------------------------------------------------
// Exports — wrangler needs these
// ---------------------------------------------------------------------------

export const AgentSessionDO = worker.AgentSessionDO;
export default worker.handler;
