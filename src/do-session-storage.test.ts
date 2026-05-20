import type { SessionTreeEntry } from "@earendil-works/pi-agent-core";
import { beforeEach, describe, expect, it } from "vitest";
import { DOSessionStorage } from "./do-session-storage.ts";
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
