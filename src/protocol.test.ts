import { describe, expect, it } from "vitest";
import type { ServerMessage } from "./protocol.ts";
import { parseClientMessage, serializeServerMessage } from "./protocol.ts";

describe("parseClientMessage", () => {
	it("parses a prompt message", () => {
		const msg = parseClientMessage(
			JSON.stringify({ type: "prompt", text: "hello" }),
		);
		expect(msg).toEqual({ type: "prompt", text: "hello" });
	});

	it("parses all simple command types", () => {
		for (const type of [
			"abort",
			"get_state",
			"clear_messages",
			"reset",
			"restore",
			"get_entries",
			"get_branch",
			"ping",
		]) {
			const msg = parseClientMessage(JSON.stringify({ type }));
			expect(msg?.type).toBe(type);
		}
	});

	it("parses set_model", () => {
		const msg = parseClientMessage(
			JSON.stringify({
				type: "set_model",
				provider: "openai",
				modelId: "gpt-4",
			}),
		);
		expect(msg?.type).toBe("set_model");
	});

	it("parses navigate with entryId", () => {
		const msg = parseClientMessage(
			JSON.stringify({ type: "navigate", entryId: "abc-123" }),
		);
		expect(msg).toEqual({ type: "navigate", entryId: "abc-123" });
	});

	it("parses label with optional label field", () => {
		const msg = parseClientMessage(
			JSON.stringify({ type: "label", targetId: "x", label: "saved" }),
		);
		expect(msg).toEqual({
			type: "label",
			targetId: "x",
			label: "saved",
		});
	});

	it("returns null for invalid JSON", () => {
		expect(parseClientMessage("not json")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(parseClientMessage("")).toBeNull();
	});

	it("returns null when type field is missing", () => {
		expect(parseClientMessage(JSON.stringify({ text: "hello" }))).toBeNull();
	});

	it("returns null when type is not a string", () => {
		expect(
			parseClientMessage(JSON.stringify({ type: 42, text: "hello" })),
		).toBeNull();
	});

	it("returns null for JSON array", () => {
		expect(parseClientMessage(JSON.stringify([1, 2, 3]))).toBeNull();
	});

	it("returns null for JSON null", () => {
		expect(parseClientMessage("null")).toBeNull();
	});
});

describe("serializeServerMessage", () => {
	it("serializes a pong message", () => {
		const msg: ServerMessage = { type: "pong" };
		const json = serializeServerMessage(msg);
		expect(JSON.parse(json)).toEqual({ type: "pong" });
	});

	it("serializes an error message", () => {
		const msg: ServerMessage = {
			type: "error",
			message: "bad request",
			code: "INVALID",
		};
		const json = serializeServerMessage(msg);
		const parsed = JSON.parse(json);
		expect(parsed.type).toBe("error");
		expect(parsed.message).toBe("bad request");
		expect(parsed.code).toBe("INVALID");
	});

	it("serializes a session_created message", () => {
		const msg: ServerMessage = {
			type: "session_created",
			sessionId: "abc-123",
		};
		const json = serializeServerMessage(msg);
		expect(JSON.parse(json)).toEqual({
			type: "session_created",
			sessionId: "abc-123",
		});
	});

	it("output is always valid JSON", () => {
		const messages: ServerMessage[] = [
			{ type: "pong" },
			{ type: "error", message: 'has "quotes" and \nnewlines' },
			{ type: "session_created", sessionId: "x" },
		];
		for (const msg of messages) {
			expect(() => JSON.parse(serializeServerMessage(msg))).not.toThrow();
		}
	});
});
