# pi-adapter-cf

> Fork of [@funtuantw/pi-agent-cf](https://github.com/funtuan/pi-agent-cf) — updated to use [@earendil-works](https://github.com/nickarellano/earendil-works) packages.

Deploy [pi-mono](https://github.com/badlogic/pi-mono) AI agents on **Cloudflare Workers** with **Durable Objects**.

Dependency-injection friendly SDK — inject your own tools, LLM providers, API keys, and storage in a few lines.

## Features

- **WebSocket streaming** — real-time bidirectional communication via Durable Objects Hibernation API
- **REST API** — create sessions, query state, send prompts over HTTP
- **Session persistence** — messages auto-saved to DO storage, survives restarts
- **Dependency injection** — factory function accepts tools, API keys, system prompt, event hooks, auth middleware
- **Multi-client** — multiple WebSocket clients can share the same agent session
- **Idle cleanup** — configurable alarm auto-evicts unused sessions from memory
- **Session context** — extract per-request context and pass it to tools and event hooks
- **Tool call limits** — configurable max tool calls per prompt with gradual steering

## Quick Start

### 1. Install

```bash
npm install pi-adapter-cf @earendil-works/pi-agent-core @earendil-works/pi-ai
```

### 2. Create your worker

```typescript
// src/index.ts
import { createAgentWorker, type AgentEnv, type AgentTool } from 'pi-adapter-cf';
import { Type } from '@sinclair/typebox';

interface Env extends AgentEnv {
  GOOGLE_API_KEY?: string;
}

// Define a custom tool
const GetTime: AgentTool<typeof Type.Object({})> = {
  name: 'get_time',
  label: 'Get Time',
  description: 'Returns the current UTC time.',
  parameters: Type.Object({}),
  execute: async () => ({
    content: [{ type: 'text', text: new Date().toISOString() }],
    details: null,
  }),
};

// Create the worker with DI config
const worker = createAgentWorker<Env>({
  systemPrompt: 'You are a helpful assistant.',
  tools: () => [GetTime],
  getApiKey: (provider, env) => {
    if (provider === 'google') return env.GOOGLE_API_KEY;
  },
});

export const AgentSessionDO = worker.AgentSessionDO;
export default worker.handler;
```

### 3. Configure wrangler.toml

```toml
name = "my-agent"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "AGENT_SESSION", class_name = "AgentSessionDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["AgentSessionDO"]

# Required: AJV uses new Function() which is forbidden in CF Workers.
# This stub disables schema validation; pi-ai falls back to trusting LLM output.
[alias]
"ajv" = "node_modules/pi-adapter-cf/stubs/ajv.js"
```

### 4. Set secrets & deploy

```bash
wrangler secret put GOOGLE_API_KEY
wrangler deploy
```

## API

### REST Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create a new session |
| `GET` | `/sessions/:id/ws` | WebSocket upgrade |
| `GET` | `/sessions/:id/state` | Get current agent state |
| `POST` | `/sessions/:id/prompt` | Send a prompt (fire-and-forget) |
| `DELETE` | `/sessions/:id` | Delete session & data |
| `GET` | `/health` | Health check |

### WebSocket Protocol

Connect to `/sessions/:id/ws` and send JSON messages:

**Client -> Server:**

```jsonc
{ "type": "prompt", "text": "Hello!" }           // Start a conversation
{ "type": "steer", "message": { ... } }           // Inject mid-turn
{ "type": "follow_up", "message": { ... } }       // Queue post-turn
{ "type": "abort" }                                // Stop generation
{ "type": "get_state" }                            // Query state
{ "type": "set_model", "provider": "anthropic", "modelId": "claude-sonnet-4-20250514" }
{ "type": "set_thinking_level", "level": "medium" }
{ "type": "clear_messages" }                       // Clear history
{ "type": "reset" }                                // Full reset
{ "type": "restore" }                              // Restore from storage
{ "type": "ping" }
```

**Server -> Client:**

```jsonc
{ "type": "event", "event": { "type": "message_update", ... } }  // AgentEvent stream
{ "type": "state", "state": { ... } }              // State response
{ "type": "restored", "messages": [...] }           // Restored messages
{ "type": "error", "message": "...", "code": "..." }
{ "type": "session_created", "sessionId": "..." }
{ "type": "pong" }
```

## Configuration (`AgentWorkerConfig`)

| Property | Type | Description |
|----------|------|-------------|
| `systemPrompt` | `string \| (env) => string` | **Required.** System prompt for the agent |
| `getApiKey` | `(provider, env) => string?` | **Required.** Resolve API keys from env secrets |
| `tools` | `(env, ctx) => AgentTool[]` | Custom tools (receive CF env and session context) |
| `model` | `Model` | Default LLM model |
| `streamFn` | `StreamFn` | Custom stream function (e.g. AI Gateway routing) |
| `transformContext` | `fn` | Transform context before LLM call (e.g. RAG injection) |
| `convertToLlm` | `fn` | Custom message format conversion |
| `thinkingLevel` | `ThinkingLevel` | Default thinking level |
| `onEvent` | `(sessionId, event, env, ctx) => void` | Global event hook for logging/analytics |
| `authenticate` | `(request, env) => boolean` | Auth middleware |
| `extractSessionContext` | `(request, env) => Ctx` | Extract per-session context from requests |
| `maxSessionIdleMs` | `number` | Idle timeout before memory cleanup (default: 5min) |
| `maxPersistedMessages` | `number` | Max messages to persist (default: 200) |
| `maxToolCalls` | `number` | Max tool calls per prompt (default: unlimited) |

## Architecture

```
Client (Browser/App)
    <-> WebSocket / REST
CF Worker (Router)
    <-> Durable Object stub
AgentSession DO (one per session)
    |-- Agent instance (pi-agent-core)
    |-- StreamFn -> LLM Provider (pi-ai fetch)
    |-- Custom Tools (injected via config)
    +-- DO Storage (persistent messages)
```

## Compatibility

> **Important:** `pi-ai` depends on AJV for JSON-schema validation, which uses `new Function()` internally — forbidden in Cloudflare Workers. The SDK ships a stub at `stubs/ajv.js` that disables AJV so `pi-ai` falls back to trusting the LLM output directly. **You must add the `[alias]` section to your `wrangler.toml`** (see step 3 above).
>
> Also, if you use `undici` >= 7 (pulled by `pi-ai`), add `"undici": "^6.21.0"` to your `overrides` in `package.json` to avoid `node:sqlite` bundling issues.

The SDK uses only `pi-agent-core` (zero Node.js deps) and `pi-ai` (uses `fetch()` for LLM calls). The following providers work out of the box on CF Workers:

- Google (Gemini)
- Anthropic (Claude)
- OpenAI (GPT, o-series)
- Azure OpenAI
- OpenAI-compatible (Groq, OpenRouter, etc.)

## License

MIT
