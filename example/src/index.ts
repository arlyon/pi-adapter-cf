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

import { Type } from "@sinclair/typebox";
import {
	type AgentEnv,
	type AgentTool,
	createAgentWorker,
	getModel,
} from "../../src/index.js";

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
	expression: Type.String({
		description: "A mathematical expression to evaluate, e.g. '2 + 3 * 4'",
	}),
});

const Calculate: AgentTool<typeof CalculateSchema> = {
	name: "calculate",
	label: "Calculator",
	description:
		"Evaluates a simple mathematical expression and returns the result.",
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
	// Recursive descent parser — no eval() / new Function() needed (CF Workers safe)
	const src = expr.replace(/\s+/g, "");
	if (!/^[0-9+\-*/().]+$/.test(src)) {
		throw new Error("Expression contains invalid characters");
	}
	let pos = 0;

	function parseExpr(): number {
		let left = parseTerm();
		while (pos < src.length && (src[pos] === "+" || src[pos] === "-")) {
			const op = src[pos++];
			const right = parseTerm();
			left = op === "+" ? left + right : left - right;
		}
		return left;
	}

	function parseTerm(): number {
		let left = parseFactor();
		while (pos < src.length && (src[pos] === "*" || src[pos] === "/")) {
			const op = src[pos++];
			const right = parseFactor();
			if (op === "/") {
				if (right === 0) throw new Error("Division by zero");
				left = left / right;
			} else {
				left = left * right;
			}
		}
		return left;
	}

	function parseFactor(): number {
		if (src[pos] === "(") {
			pos++; // skip "("
			const val = parseExpr();
			if (src[pos] !== ")") throw new Error("Missing closing parenthesis");
			pos++; // skip ")"
			return val;
		}
		if (src[pos] === "-") {
			pos++;
			return -parseFactor();
		}
		const start = pos;
		while (pos < src.length && /[0-9.]/.test(src[pos])) pos++;
		if (pos === start) throw new Error(`Unexpected character: ${src[pos]}`);
		return parseFloat(src.slice(start, pos));
	}

	const result = parseExpr();
	if (pos !== src.length) throw new Error(`Unexpected character: ${src[pos]}`);
	return result;
}

// ---------------------------------------------------------------------------
// Create the worker
// ---------------------------------------------------------------------------

const worker = createAgentWorker<Env>({
	model: getModel("google", "gemini-3-flash-preview"),

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
