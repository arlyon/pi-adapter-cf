import { beforeEach, describe, expect, it } from "vitest";
import { DOSessionStorage } from "./do-session-storage.ts";
import {
	SessionTree as Session,
	type SessionTreeEntry,
} from "./session-tree.ts";
import { MockDurableObjectStorage } from "./test-utils.ts";

function castStorage(mock: MockDurableObjectStorage): DurableObjectStorage {
	return mock as unknown as DurableObjectStorage;
}

function makeLeafEntry(
	id: string,
	parentId: string | null,
	targetId: string,
): SessionTreeEntry {
	return { id, type: "leaf", parentId, targetId } as SessionTreeEntry;
}

function makeLabelEntry(
	id: string,
	parentId: string | null,
	targetId: string,
	label?: string,
): SessionTreeEntry {
	return { id, type: "label", parentId, targetId, label } as SessionTreeEntry;
}

function makeMessageEntry(
	id: string,
	parentId: string | null,
): SessionTreeEntry {
	return {
		id,
		type: "message",
		parentId,
		timestamp: Date.now(),
		message: { role: "assistant", content: "hello" },
	} as unknown as SessionTreeEntry;
}

describe("DOSessionStorage.create + open", () => {
	let storage: MockDurableObjectStorage;

	beforeEach(() => {
		storage = new MockDurableObjectStorage();
	});

	it("create stores metadata and open returns instance", async () => {
		const ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
		const meta = await ss.getMetadata();
		expect(meta.id).toBe("sess-1");
		expect(meta.createdAt).toBeTruthy();

		const reopened = await DOSessionStorage.open(castStorage(storage));
		expect(reopened).not.toBeNull();
		if (reopened === null) throw new Error("unreachable");
		const meta2 = await reopened.getMetadata();
		expect(meta2.id).toBe("sess-1");
	});

	it("open returns null on empty storage", async () => {
		const result = await DOSessionStorage.open(castStorage(storage));
		expect(result).toBeNull();
	});
});

describe("DOSessionStorage entries", () => {
	let storage: MockDurableObjectStorage;
	let ss: DOSessionStorage;

	beforeEach(async () => {
		storage = new MockDurableObjectStorage();
		ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
	});

	it("appendEntry + getEntry round-trips", async () => {
		const entry = makeMessageEntry("e1", null);
		await ss.appendEntry(entry);
		const retrieved = await ss.getEntry("e1");
		expect(retrieved).toEqual(entry);
	});

	it("leaf entry updates the leaf pointer", async () => {
		const leaf = makeLeafEntry("e1", null, "target-1");
		await ss.appendEntry(leaf);
		const leafId = await ss.getLeafId();
		expect(leafId).toBe("target-1");
	});

	it("label entry stores the label separately", async () => {
		const label = makeLabelEntry("e1", null, "target-1", "bookmarked");
		await ss.appendEntry(label);
		const stored = await ss.getLabel("target-1");
		expect(stored).toBe("bookmarked");
	});

	it("label entry with undefined label deletes the label", async () => {
		// First set a label
		await ss.appendEntry(makeLabelEntry("e1", null, "target-1", "saved"));
		expect(await ss.getLabel("target-1")).toBe("saved");

		// Then remove it
		await ss.appendEntry(makeLabelEntry("e2", null, "target-1", undefined));
		expect(await ss.getLabel("target-1")).toBeUndefined();
	});

	it("getEntries returns entries in insertion order", async () => {
		await ss.appendEntry(makeMessageEntry("a", null));
		await ss.appendEntry(makeMessageEntry("b", "a"));
		await ss.appendEntry(makeMessageEntry("c", "b"));

		const entries = await ss.getEntries();
		expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
	});

	it("findEntries filters by type", async () => {
		await ss.appendEntry(makeMessageEntry("m1", null));
		await ss.appendEntry(makeLabelEntry("l1", null, "m1", "test"));
		await ss.appendEntry(makeMessageEntry("m2", "m1"));

		const messages = await ss.findEntries("message");
		expect(messages.length).toBe(2);
		expect(messages.every((e) => e.type === "message")).toBe(true);

		const labels = await ss.findEntries("label");
		expect(labels.length).toBe(1);
		expect(labels[0].type).toBe("label");
	});

	it("setLeafId + getLeafId", async () => {
		expect(await ss.getLeafId()).toBeNull();
		await ss.setLeafId("leaf-1");
		expect(await ss.getLeafId()).toBe("leaf-1");
		await ss.setLeafId(null);
		expect(await ss.getLeafId()).toBeNull();
	});

	it("createEntryId returns a string", async () => {
		const id = await ss.createEntryId();
		expect(typeof id).toBe("string");
		expect(id.length).toBeGreaterThan(0);
	});
});

describe("DOSessionStorage.getPathToRoot", () => {
	let storage: MockDurableObjectStorage;
	let ss: DOSessionStorage;

	beforeEach(async () => {
		storage = new MockDurableObjectStorage();
		ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
	});

	it("returns empty array for null leafId", async () => {
		const path = await ss.getPathToRoot(null);
		expect(path).toEqual([]);
	});

	it("returns single entry for root node", async () => {
		const entry = makeMessageEntry("root", null);
		await ss.appendEntry(entry);
		const path = await ss.getPathToRoot("root");
		expect(path.length).toBe(1);
		expect(path[0].id).toBe("root");
	});

	it("returns root-first path for a chain", async () => {
		await ss.appendEntry(makeMessageEntry("a", null));
		await ss.appendEntry(makeMessageEntry("b", "a"));
		await ss.appendEntry(makeMessageEntry("c", "b"));

		const path = await ss.getPathToRoot("c");
		expect(path.map((e) => e.id)).toEqual(["a", "b", "c"]);
	});
});

describe("DOSessionStorage.deleteAll", () => {
	it("clears all storage", async () => {
		const storage = new MockDurableObjectStorage();
		const ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
		await ss.appendEntry(makeMessageEntry("e1", null));
		expect(storage._raw.size).toBeGreaterThan(0);

		await ss.deleteAll();
		expect(storage._raw.size).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Regression: appending content entries must advance the leaf pointer.
//
// `Session.appendMessage` sets a new message's `parentId` to the CURRENT leaf
// and relies on the storage to advance the leaf to the appended entry. Today
// `appendEntry` only moves the leaf for `type: "leaf"` entries, so message
// entries never become the leaf: `getLeafId()` stays null, every message is
// orphaned at the root, and `getPathToRoot`/`buildContext` return nothing —
// i.e. conversation history is silently lost on reload.
// ---------------------------------------------------------------------------
describe("DOSessionStorage leaf advancement (history regression)", () => {
	let storage: MockDurableObjectStorage;
	let ss: DOSessionStorage;

	beforeEach(async () => {
		storage = new MockDurableObjectStorage();
		ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
	});

	it("appending a message entry advances the leaf to that entry", async () => {
		await ss.appendEntry(makeMessageEntry("m1", null));
		expect(await ss.getLeafId()).toBe("m1");
	});

	it("appended messages chain via parentId and are reconstructable from the leaf", async () => {
		// Mirror exactly what Session.appendMessage does: parentId = current leaf.
		await ss.appendEntry(makeMessageEntry("m1", await ss.getLeafId()));
		await ss.appendEntry(makeMessageEntry("m2", await ss.getLeafId()));
		await ss.appendEntry(makeMessageEntry("m3", await ss.getLeafId()));

		const path = await ss.getPathToRoot(await ss.getLeafId());
		expect(path.map((e) => e.id)).toEqual(["m1", "m2", "m3"]);
	});
});

// ---------------------------------------------------------------------------
// Regression (integration): a real pi-agent-core Session over DOSessionStorage
// must round-trip appended messages through buildContext(). This is the exact
// path the Durable Object uses (_persistMessages -> appendMessage, then
// _loadMessagesFromSession -> buildContext).
// ---------------------------------------------------------------------------
describe("Session over DOSessionStorage round-trip (history regression)", () => {
	it("buildContext returns messages previously appended via the Session", async () => {
		const storage = new MockDurableObjectStorage();
		const ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
		const session = new Session(ss);

		await session.appendMessage({
			role: "user",
			content: [{ type: "text", text: "remember the number 42" }],
		} as Parameters<Session["appendMessage"]>[0]);
		await session.appendMessage({
			role: "assistant",
			content: [{ type: "text", text: "got it" }],
		} as Parameters<Session["appendMessage"]>[0]);

		const ctx = await session.buildContext();
		expect(ctx.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	});
});

// ---------------------------------------------------------------------------
// Caching invariants.
//
// LLM prompt caching (e.g. DeepSeek context caching) only produces cache hits
// when each turn sends a prefix that is byte-identical to the previous turn's
// prefix. For that to hold, the session history must be:
//   1. append-only — earlier entries are never mutated, and
//   2. reconstructed deterministically — the same call yields the same order,
// so the reconstructed history after turn N is an exact prefix of the history
// after turn N+1. These tests pin those invariants.
// ---------------------------------------------------------------------------
describe("DOSessionStorage caching invariants (stable prompt prefix)", () => {
	let storage: MockDurableObjectStorage;
	let ss: DOSessionStorage;

	beforeEach(async () => {
		storage = new MockDurableObjectStorage();
		ss = await DOSessionStorage.create(castStorage(storage), "sess-1");
	});

	// This invariant holds today and must keep holding: appending new turns
	// must never rewrite an earlier entry, or the cached prefix is invalidated.
	it("appending later entries never mutates an earlier entry (append-only)", async () => {
		await ss.appendEntry(makeMessageEntry("m1", null));
		const snapshot = JSON.stringify(await ss.getEntry("m1"));

		await ss.appendEntry(makeMessageEntry("m2", "m1"));
		await ss.appendEntry(makeMessageEntry("m3", "m2"));

		expect(JSON.stringify(await ss.getEntry("m1"))).toBe(snapshot);
	});

	it("reconstructs the same history deterministically on repeated reads", async () => {
		await ss.appendEntry(makeMessageEntry("m1", await ss.getLeafId()));
		await ss.appendEntry(makeMessageEntry("m2", await ss.getLeafId()));

		const first = (await ss.getPathToRoot(await ss.getLeafId())).map(
			(e) => e.id,
		);
		const second = (await ss.getPathToRoot(await ss.getLeafId())).map(
			(e) => e.id,
		);

		expect(second).toEqual(first);
		expect(first).toEqual(["m1", "m2"]);
	});

	it("history after each turn is an exact prefix of the history after the next turn", async () => {
		// Turn 1
		await ss.appendEntry(makeMessageEntry("u1", await ss.getLeafId()));
		await ss.appendEntry(makeMessageEntry("a1", await ss.getLeafId()));
		const afterTurn1 = (await ss.getPathToRoot(await ss.getLeafId())).map(
			(e) => e.id,
		);

		// Turn 2
		await ss.appendEntry(makeMessageEntry("u2", await ss.getLeafId()));
		await ss.appendEntry(makeMessageEntry("a2", await ss.getLeafId()));
		const afterTurn2 = (await ss.getPathToRoot(await ss.getLeafId())).map(
			(e) => e.id,
		);

		// The earlier history must be the exact leading slice of the later one —
		// this is precisely the prefix a prompt cache reuses.
		expect(afterTurn2.slice(0, afterTurn1.length)).toEqual(afterTurn1);
		expect(afterTurn1).toEqual(["u1", "a1"]);
		expect(afterTurn2).toEqual(["u1", "a1", "u2", "a2"]);
	});

	it("Session message objects grow as a stable prefix (cacheable across turns)", async () => {
		const session = new Session(ss);
		const msg = (role: string, text: string) =>
			({ role, content: [{ type: "text", text }] }) as Parameters<
				Session["appendMessage"]
			>[0];

		await session.appendMessage(msg("user", "first question"));
		const ctxTurn1 = await session.buildContext();

		await session.appendMessage(msg("assistant", "first answer"));
		await session.appendMessage(msg("user", "second question"));
		const ctxTurn2 = await session.buildContext();

		// The messages already sent last turn must reappear identically (same
		// order AND same content) at the head of this turn's context.
		expect(ctxTurn2.messages.slice(0, ctxTurn1.messages.length)).toEqual(
			ctxTurn1.messages,
		);
		expect(ctxTurn2.messages.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
		]);
	});
});
