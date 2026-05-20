import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it } from "vitest";
import {
	deleteSession,
	hasPersistedSession,
	loadMessages,
	saveMessages,
} from "./session-persistence.ts";
import { MockDurableObjectStorage } from "./test-utils.ts";

function makeMsg(text: string): AgentMessage {
	return { role: "assistant", content: text } as unknown as AgentMessage;
}

/** Create a message whose JSON is roughly `byteSize` bytes. */
function makeLargeMsg(byteSize: number): AgentMessage {
	const padding = "x".repeat(Math.max(0, byteSize - 30));
	return { role: "assistant", content: padding } as unknown as AgentMessage;
}

describe("hasPersistedSession", () => {
	let storage: MockDurableObjectStorage;

	beforeEach(() => {
		storage = new MockDurableObjectStorage();
	});

	it("returns false when no metadata exists", async () => {
		expect(
			await hasPersistedSession(storage as unknown as DurableObjectStorage),
		).toBe(false);
	});

	it("returns false when messageCount is 0", async () => {
		await storage.put("meta", {
			chunkCount: 0,
			messageCount: 0,
			createdAt: 0,
			updatedAt: 0,
		});
		expect(
			await hasPersistedSession(storage as unknown as DurableObjectStorage),
		).toBe(false);
	});

	it("returns true when messages exist", async () => {
		await storage.put("meta", {
			chunkCount: 1,
			messageCount: 5,
			createdAt: 0,
			updatedAt: 0,
		});
		expect(
			await hasPersistedSession(storage as unknown as DurableObjectStorage),
		).toBe(true);
	});
});

describe("saveMessages + loadMessages", () => {
	let storage: MockDurableObjectStorage;

	beforeEach(() => {
		storage = new MockDurableObjectStorage();
	});

	it("round-trips messages", async () => {
		const msgs = [makeMsg("hello"), makeMsg("world")];
		await saveMessages(storage as unknown as DurableObjectStorage, msgs);
		const loaded = await loadMessages(
			storage as unknown as DurableObjectStorage,
		);
		expect(loaded).toEqual(msgs);
	});

	it("returns empty array when nothing is saved", async () => {
		const loaded = await loadMessages(
			storage as unknown as DurableObjectStorage,
		);
		expect(loaded).toEqual([]);
	});

	it("truncates to maxMessages", async () => {
		const msgs = Array.from({ length: 10 }, (_, i) => makeMsg(`msg-${i}`));
		await saveMessages(storage as unknown as DurableObjectStorage, msgs, 5);
		const loaded = await loadMessages(
			storage as unknown as DurableObjectStorage,
		);
		expect(loaded.length).toBe(5);
		// Should keep the last 5
		expect((loaded[0] as any).content).toBe("msg-5");
		expect((loaded[4] as any).content).toBe("msg-9");
	});

	it("chunks large messages across multiple keys", async () => {
		// Each message ~50KB, so 3 should require multiple chunks (limit 100KB)
		const msgs = [
			makeLargeMsg(50_000),
			makeLargeMsg(50_000),
			makeLargeMsg(50_000),
		];
		await saveMessages(storage as unknown as DurableObjectStorage, msgs);

		// Verify multiple chunk keys exist
		const meta = await storage.get<{
			chunkCount: number;
			messageCount: number;
		}>("meta");
		expect(meta).toBeTruthy();
		expect(meta?.chunkCount).toBeGreaterThan(1);
		expect(meta?.messageCount).toBe(3);

		// Round-trip should still work
		const loaded = await loadMessages(
			storage as unknown as DurableObjectStorage,
		);
		expect(loaded.length).toBe(3);
	});

	it("cleans up old chunks when re-saving fewer", async () => {
		// First save: many large messages → multiple chunks
		const largeMsgs = [
			makeLargeMsg(50_000),
			makeLargeMsg(50_000),
			makeLargeMsg(50_000),
		];
		await saveMessages(storage as unknown as DurableObjectStorage, largeMsgs);
		const meta1 = await storage.get<{ chunkCount: number }>("meta");
		const oldChunkCount = meta1?.chunkCount ?? 0;

		// Second save: fewer messages → fewer chunks
		await saveMessages(storage as unknown as DurableObjectStorage, [
			makeMsg("small"),
		]);
		const meta2 = await storage.get<{ chunkCount: number }>("meta");
		expect(meta2?.chunkCount).toBeLessThan(oldChunkCount);

		// Old chunk keys should be gone
		for (let i = meta2?.chunkCount ?? 0; i < oldChunkCount; i++) {
			const val = await storage.get(`msgs:${i}`);
			expect(val).toBeUndefined();
		}
	});
});

describe("deleteSession", () => {
	it("clears all storage", async () => {
		const storage = new MockDurableObjectStorage();
		await saveMessages(storage as unknown as DurableObjectStorage, [
			makeMsg("test"),
		]);
		expect(storage._raw.size).toBeGreaterThan(0);

		await deleteSession(storage as unknown as DurableObjectStorage);
		expect(storage._raw.size).toBe(0);
	});
});
