/**
 * pi-adapter-cf — AgentSession Durable Object
 *
 * Each instance manages ONE agent session:
 * - Holds an in-memory `Agent` from pi-agent-core
 * - Persists conversation as a session tree via DOSessionStorage
 * - Accepts WebSocket connections (Hibernation API)
 * - Broadcasts AgentEvents to all connected clients
 * - Sets an alarm to clean up after idle timeout
 */

import type {
	AgentEvent,
	AgentMessage,
	AgentTool,
	SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { Agent, Session } from "@earendil-works/pi-agent-core";
import { getModel } from "@earendil-works/pi-ai";
import { DOSessionStorage } from "./do-session-storage.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";
import { parseClientMessage, serializeServerMessage } from "./protocol.ts";
import type {
	AgentEnv,
	AgentWorkerConfig,
	SerializableAgentState,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Factory — creates a DO class bound to a specific config
// ---------------------------------------------------------------------------

/**
 * Create an AgentSession Durable Object class with the given config baked in.
 * This is called by `createAgentWorker()`.
 */
export function createAgentSessionDOClass<Env extends AgentEnv, Ctx = void>(
	config: AgentWorkerConfig<Env, Ctx>,
) {
	const DEFAULT_IDLE_MS = 5 * 60 * 1000; // 5 min

	return class AgentSessionDO implements DurableObject {
		/** @internal */ _ctx: DurableObjectState;
		/** @internal */ _env: Env;
		/** @internal */ _agent: Agent | null = null;
		/** @internal */ _unsubscribe: (() => void) | null = null;
		/** @internal */ _sessionId: string;
		/** @internal */ _sessionContext: Ctx | undefined = undefined;
		/** @internal */ _toolCallCount = 0;
		/** @internal */ _session: Session | null = null;

		constructor(ctx: DurableObjectState, env: Env) {
			this._ctx = ctx;
			this._env = env;
			this._sessionId = ctx.id.toString();

			// Accept WebSocket Hibernation
			this._ctx.setWebSocketAutoResponse(
				new WebSocketRequestResponsePair(
					"ping",
					JSON.stringify({ type: "pong" }),
				),
			);
		}

		// -----------------------------------------------------------------
		// Session tree
		// -----------------------------------------------------------------

		/** @internal */
		async _ensureSession(): Promise<Session> {
			if (this._session) return this._session;
			const storage =
				(await DOSessionStorage.open(this._ctx.storage)) ??
				(await DOSessionStorage.create(this._ctx.storage, this._sessionId));
			this._session = new Session(storage);
			return this._session;
		}

		/** @internal */
		async _persistMessages(messages: AgentMessage[]): Promise<void> {
			const session = await this._ensureSession();
			const existingEntries = await session.getEntries();
			const existingMessageCount = existingEntries.filter(
				(e: SessionTreeEntry) => e.type === "message",
			).length;

			// Only append messages that are new since last persist
			const newMessages = messages.slice(existingMessageCount);
			for (const msg of newMessages) {
				await session.appendMessage(msg);
			}
		}

		/** @internal */
		async _loadMessagesFromSession(): Promise<AgentMessage[]> {
			const session = await this._ensureSession();
			const ctx = await session.buildContext();
			return ctx.messages;
		}

		// -----------------------------------------------------------------
		// Agent lifecycle
		// -----------------------------------------------------------------

		/** @internal */
		async _loadSessionContext(): Promise<Ctx | undefined> {
			if (this._sessionContext !== undefined) return this._sessionContext;
			const stored = await this._ctx.storage.get<Ctx>("session_context");
			if (stored !== undefined) this._sessionContext = stored;
			return this._sessionContext;
		}

		/** @internal */
		_ensureAgent(ctx?: Ctx): Agent {
			if (this._agent) return this._agent;

			const env = this._env;
			const sessionCtx = ctx ?? this._sessionContext;
			const systemPrompt =
				typeof config.systemPrompt === "function"
					? config.systemPrompt(env)
					: config.systemPrompt;

			const tools: AgentTool<any>[] = config.tools
				? config.tools(env, sessionCtx as Ctx)
				: [];

			this._agent = new Agent({
				initialState: {
					systemPrompt,
					tools,
					...(config.model ? { model: config.model } : {}),
					...(config.thinkingLevel
						? { thinkingLevel: config.thinkingLevel }
						: {}),
				},
				streamFn: config.streamFn,
				transformContext: config.transformContext,
				convertToLlm: config.convertToLlm,
				getApiKey: (provider) => config.getApiKey(provider, env),
				sessionId: this._sessionId,
			});

			// Subscribe to events and broadcast to all connected WS clients
			this._unsubscribe = this._agent.subscribe((event) => {
				this._broadcastEvent(event);

				// Reset tool call counter at the start of each prompt
				if (event.type === "agent_start") {
					this._toolCallCount = 0;
				}

				// Enforce max tool calls per prompt
				if (
					event.type === "tool_execution_end" &&
					config.maxToolCalls &&
					this._agent
				) {
					this._toolCallCount++;
					const warningAt = Math.floor((config.maxToolCalls * 2) / 3);
					if (this._toolCallCount === warningAt) {
						this._agent.steer({
							role: "user",
							content: [
								{
									type: "text",
									text: `You have used ${this._toolCallCount} of ${config.maxToolCalls} available tool calls. Start wrapping up and prepare to respond with what you have.`,
								},
							],
							timestamp: Date.now(),
						});
					} else if (this._toolCallCount >= config.maxToolCalls) {
						this._agent.steer({
							role: "user",
							content: [
								{
									type: "text",
									text: "You have reached the maximum number of tool calls for this request. Respond now with the information you have gathered so far.",
								},
							],
							timestamp: Date.now(),
						});
					}
				}

				// Persist on turn_end via session tree
				if (event.type === "turn_end" && this._agent) {
					this._ctx.waitUntil(
						this._persistMessages(this._agent.state.messages),
					);
				}

				// Fire global hook
				if (config.onEvent) {
					try {
						const result = config.onEvent(
							this._sessionId,
							event,
							env,
							sessionCtx as Ctx,
						);
						if (result instanceof Promise) {
							this._ctx.waitUntil(result);
						}
					} catch {
						// Don't let hook errors crash the agent
					}
				}
			});

			return this._agent;
		}

		/** @internal */
		_destroyAgent(): void {
			if (this._unsubscribe) {
				this._unsubscribe();
				this._unsubscribe = null;
			}
			if (this._agent) {
				this._agent.abort();
				this._agent.reset();
				this._agent = null;
			}
		}

		// -----------------------------------------------------------------
		// State serialisation
		// -----------------------------------------------------------------

		/** @internal */
		_getSerializableState(): SerializableAgentState {
			const agent = this._ensureAgent(this._sessionContext);
			const s = agent.state;
			return {
				systemPrompt: s.systemPrompt,
				modelId: s.model.id,
				modelProvider: s.model.provider,
				thinkingLevel: s.thinkingLevel,
				toolNames: s.tools.map((t) => t.name),
				messages: s.messages,
				isStreaming: s.isStreaming,
				error: s.errorMessage,
			};
		}

		// -----------------------------------------------------------------
		// Hydration
		// -----------------------------------------------------------------

		/**
		 * If the in-memory agent has no messages but storage has history,
		 * recreate the agent seeded with the persisted messages from the
		 * session tree.
		 */
		/** @internal */
		async _hydrateFromStorageIfNeeded(): Promise<void> {
			await this._loadSessionContext();
			const agent = this._ensureAgent(this._sessionContext);
			if (agent.state.messages.length > 0) return; // already hydrated
			const persisted = await this._loadMessagesFromSession();
			if (persisted.length === 0) return;
			// Destroy current (empty) agent and recreate with persisted messages
			this._destroyAgent();
			const env = this._env;
			const sessionCtx = this._sessionContext;
			const systemPrompt =
				typeof config.systemPrompt === "function"
					? config.systemPrompt(env)
					: config.systemPrompt;
			const tools: AgentTool<any>[] = config.tools
				? config.tools(env, sessionCtx as Ctx)
				: [];
			this._agent = new Agent({
				initialState: {
					systemPrompt,
					tools,
					messages: persisted,
					...(config.model ? { model: config.model } : {}),
					...(config.thinkingLevel
						? { thinkingLevel: config.thinkingLevel }
						: {}),
				},
				streamFn: config.streamFn,
				transformContext: config.transformContext,
				convertToLlm: config.convertToLlm,
				getApiKey: (provider) => config.getApiKey(provider, env),
				sessionId: this._sessionId,
			});
		}

		// -----------------------------------------------------------------
		// WebSocket broadcast
		// -----------------------------------------------------------------

		/** @internal */
		_broadcast(msg: ServerMessage): void {
			const data = serializeServerMessage(msg);
			for (const ws of this._ctx.getWebSockets()) {
				try {
					ws.send(data);
				} catch {
					// Client disconnected — will be cleaned up via webSocketClose
				}
			}
		}

		/** @internal */
		_broadcastEvent(event: AgentEvent): void {
			this._broadcast({ type: "event", event });
		}

		/** @internal */
		_sendTo(ws: WebSocket, msg: ServerMessage): void {
			try {
				ws.send(serializeServerMessage(msg));
			} catch {
				// ignore
			}
		}

		// -----------------------------------------------------------------
		// Idle alarm
		// -----------------------------------------------------------------

		/** @internal */
		_scheduleIdleAlarm(): void {
			const idleMs = config.maxSessionIdleMs ?? DEFAULT_IDLE_MS;
			this._ctx.storage.setAlarm(Date.now() + idleMs);
		}

		async alarm(): Promise<void> {
			const sockets = this._ctx.getWebSockets();
			if (sockets.length === 0) {
				// No clients connected — tear down in-memory agent
				this._destroyAgent();
			} else {
				// Still connected — reschedule
				this._scheduleIdleAlarm();
			}
		}

		// -----------------------------------------------------------------
		// HTTP fetch — handles WS upgrade
		// -----------------------------------------------------------------

		async fetch(request: Request): Promise<Response> {
			const url = new URL(request.url);

			// WebSocket upgrade
			if (request.headers.get("Upgrade") === "websocket") {
				const pair = new WebSocketPair();
				const [client, server] = Object.values(pair);

				this._ctx.acceptWebSocket(server);

				// Send initial state
				await this._loadSessionContext();
				this._ensureAgent(this._sessionContext);
				this._sendTo(server, {
					type: "session_created",
					sessionId: this._sessionId,
				});

				this._scheduleIdleAlarm();

				return new Response(null, { status: 101, webSocket: client });
			}

			// REST: GET /state
			if (request.method === "GET" && url.pathname.endsWith("/state")) {
				await this._hydrateFromStorageIfNeeded();
				const state = this._getSerializableState();
				return Response.json(state);
			}

			// REST: GET /entries — session tree entries
			if (request.method === "GET" && url.pathname.endsWith("/entries")) {
				const session = await this._ensureSession();
				const entries = await session.getEntries();
				return Response.json(entries);
			}

			// REST: GET /branch — current branch (path to leaf)
			if (request.method === "GET" && url.pathname.endsWith("/branch")) {
				const session = await this._ensureSession();
				const branch = await session.getBranch();
				return Response.json(branch);
			}

			// REST: DELETE /
			if (request.method === "DELETE") {
				this._destroyAgent();
				this._session = null;
				const storage = await DOSessionStorage.open(this._ctx.storage);
				if (storage) await storage.deleteAll();
				else await this._ctx.storage.deleteAll();
				return new Response(null, { status: 204 });
			}

			// REST: POST /prompt  (fire-and-forget prompt via HTTP)
			if (request.method === "POST" && url.pathname.endsWith("/prompt")) {
				try {
					if (config.extractSessionContext) {
						const ctx = await config.extractSessionContext(request, this._env);
						this._sessionContext = ctx;
						await this._ctx.storage.put("session_context", ctx);
						// If agent already exists, destroy and recreate with new context
						if (this._agent) {
							this._destroyAgent();
						}
					}
					// Restore persisted conversation history before prompting
					await this._hydrateFromStorageIfNeeded();
					const body = (await request.json()) as {
						text: string;
						images?: any[];
					};
					const agent = this._ensureAgent(this._sessionContext);
					this._ctx.waitUntil(agent.prompt(body.text, body.images));
					return Response.json({ ok: true, sessionId: this._sessionId });
				} catch (e: any) {
					return Response.json({ error: e.message }, { status: 400 });
				}
			}

			// REST: POST /label — add a label to an entry
			if (request.method === "POST" && url.pathname.endsWith("/label")) {
				try {
					const body = (await request.json()) as {
						targetId: string;
						label?: string;
					};
					const session = await this._ensureSession();
					const entryId = await session.appendLabel(body.targetId, body.label);
					return Response.json({ ok: true, entryId });
				} catch (e: any) {
					return Response.json({ error: e.message }, { status: 400 });
				}
			}

			// REST: POST /navigate — move to a different branch point
			if (request.method === "POST" && url.pathname.endsWith("/navigate")) {
				try {
					const body = (await request.json()) as {
						entryId: string | null;
						summary?: string;
					};
					const session = await this._ensureSession();
					const resultId = await session.moveTo(
						body.entryId,
						body.summary ? { summary: body.summary } : undefined,
					);
					// Reload agent with new branch context
					this._destroyAgent();
					await this._hydrateFromStorageIfNeeded();
					return Response.json({ ok: true, entryId: resultId });
				} catch (e: any) {
					return Response.json({ error: e.message }, { status: 400 });
				}
			}

			return new Response("Not found", { status: 404 });
		}

		// -----------------------------------------------------------------
		// WebSocket Hibernation callbacks
		// -----------------------------------------------------------------

		async webSocketMessage(
			ws: WebSocket,
			raw: string | ArrayBuffer,
		): Promise<void> {
			const text =
				typeof raw === "string" ? raw : new TextDecoder().decode(raw);
			const msg = parseClientMessage(text);
			if (!msg) {
				this._sendTo(ws, {
					type: "error",
					message: "Invalid message format",
					code: "PARSE_ERROR",
				});
				return;
			}

			try {
				await this._handleClientMessage(ws, msg);
			} catch (e: any) {
				this._sendTo(ws, {
					type: "error",
					message: e.message ?? "Internal error",
					code: "INTERNAL",
				});
			}
		}

		async webSocketClose(
			ws: WebSocket,
			code: number,
			reason: string,
			_wasClean: boolean,
		): Promise<void> {
			ws.close(code, reason);
			// If no more sockets, schedule idle cleanup
			if (this._ctx.getWebSockets().length === 0) {
				this._scheduleIdleAlarm();
			}
		}

		async webSocketError(ws: WebSocket, _error: unknown): Promise<void> {
			ws.close(1011, "WebSocket error");
		}

		// -----------------------------------------------------------------
		// Message dispatch
		// -----------------------------------------------------------------

		/** @internal */
		async _handleClientMessage(
			ws: WebSocket,
			msg: ClientMessage,
		): Promise<void> {
			const agent = this._ensureAgent(this._sessionContext);

			switch (msg.type) {
				case "prompt":
					await agent.prompt(msg.text, msg.images);
					break;

				case "steer":
					agent.steer(msg.message);
					break;

				case "follow_up":
					agent.followUp(msg.message);
					break;

				case "abort":
					agent.abort();
					break;

				case "get_state":
					this._sendTo(ws, {
						type: "state",
						state: this._getSerializableState(),
					});
					break;

				case "set_model": {
					// getModel requires KnownProvider — cast since user may send any string
					try {
						const model = getModel(msg.provider as any, msg.modelId as any);
						if (model) {
							agent.state.model = model;
						} else {
							this._sendTo(ws, {
								type: "error",
								message: `Unknown model: ${msg.provider}/${msg.modelId}`,
								code: "UNKNOWN_MODEL",
							});
						}
					} catch {
						this._sendTo(ws, {
							type: "error",
							message: `Unknown model: ${msg.provider}/${msg.modelId}`,
							code: "UNKNOWN_MODEL",
						});
					}
					break;
				}

				case "set_thinking_level":
					agent.state.thinkingLevel = msg.level;
					break;

				case "clear_messages": {
					agent.state.messages = [];
					// Reset session tree
					this._session = null;
					const storage = await DOSessionStorage.open(this._ctx.storage);
					if (storage) await storage.deleteAll();
					await DOSessionStorage.create(this._ctx.storage, this._sessionId);
					break;
				}

				case "reset": {
					agent.reset();
					this._session = null;
					const resetStorage = await DOSessionStorage.open(this._ctx.storage);
					if (resetStorage) await resetStorage.deleteAll();
					else await this._ctx.storage.deleteAll();
					break;
				}

				case "restore": {
					const messages = await this._loadMessagesFromSession();
					if (messages.length > 0) {
						agent.state.messages = messages;
					}
					this._sendTo(ws, { type: "restored", messages });
					break;
				}

				case "get_entries": {
					const session = await this._ensureSession();
					const entries = await session.getEntries();
					this._sendTo(ws, { type: "entries", entries });
					break;
				}

				case "get_branch": {
					const session = await this._ensureSession();
					const branch = await session.getBranch();
					this._sendTo(ws, { type: "branch", entries: branch });
					break;
				}

				case "label": {
					const session = await this._ensureSession();
					await session.appendLabel(msg.targetId, msg.label);
					break;
				}

				case "navigate": {
					const session = await this._ensureSession();
					await session.moveTo(
						msg.entryId,
						msg.summary ? { summary: msg.summary } : undefined,
					);
					// Reload agent with new branch context
					this._destroyAgent();
					await this._hydrateFromStorageIfNeeded();
					const newState = this._getSerializableState();
					this._sendTo(ws, { type: "state", state: newState });
					break;
				}

				case "ping":
					this._sendTo(ws, { type: "pong" });
					break;

				default:
					this._sendTo(ws, {
						type: "error",
						message: `Unknown message type: ${(msg as any).type}`,
						code: "UNKNOWN_TYPE",
					});
			}
		}
	};
}
