/**
 * pi-adapter-cf — Durable Object SessionStorage implementation
 *
 * Implements the pi-agent-core SessionStorage interface backed by
 * Cloudflare Durable Object transactional storage.
 *
 * Storage layout:
 *   "session:meta"       → SessionMetadata
 *   "session:leaf"       → string | null
 *   "session:entry:<id>" → SessionTreeEntry
 *   "session:label:<id>" → string
 *   "session:idx"        → string[] (ordered entry IDs for list/find)
 */

import type {
	SessionMetadata,
	SessionStorage,
	SessionTreeEntry,
} from "@earendil-works/pi-agent-core";
import { uuidv7 } from "@earendil-works/pi-agent-core";

const KEY_META = "session:meta";
const KEY_LEAF = "session:leaf";
const KEY_IDX = "session:idx";
const ENTRY_PREFIX = "session:entry:";
const LABEL_PREFIX = "session:label:";

/**
 * SessionStorage backed by Durable Object storage.
 *
 * Each session tree entry is stored as an individual key,
 * with an ordered index for iteration. Labels are stored
 * separately for efficient lookup.
 */
export class DOSessionStorage implements SessionStorage<SessionMetadata> {
	private readonly storage: DurableObjectStorage;
	private readonly metadata: SessionMetadata;

	constructor(storage: DurableObjectStorage, metadata: SessionMetadata) {
		this.storage = storage;
		this.metadata = metadata;
	}

	/**
	 * Initialize storage for a new session, persisting the metadata.
	 * Call this once when the session is first created.
	 */
	static async create(
		storage: DurableObjectStorage,
		sessionId: string,
	): Promise<DOSessionStorage> {
		const metadata: SessionMetadata = {
			id: sessionId,
			createdAt: new Date().toISOString(),
		};
		await storage.put(KEY_META, metadata);
		await storage.put(KEY_IDX, [] as string[]);
		return new DOSessionStorage(storage, metadata);
	}

	/**
	 * Open an existing session from DO storage.
	 * Returns null if no session metadata exists.
	 */
	static async open(
		storage: DurableObjectStorage,
	): Promise<DOSessionStorage | null> {
		const metadata = await storage.get<SessionMetadata>(KEY_META);
		if (!metadata) return null;
		return new DOSessionStorage(storage, metadata);
	}

	async getMetadata(): Promise<SessionMetadata> {
		return this.metadata;
	}

	async getLeafId(): Promise<string | null> {
		const leafId = await this.storage.get<string | null>(KEY_LEAF);
		return leafId ?? null;
	}

	async setLeafId(leafId: string | null): Promise<void> {
		await this.storage.put(KEY_LEAF, leafId);
	}

	async createEntryId(): Promise<string> {
		return uuidv7();
	}

	async appendEntry(entry: SessionTreeEntry): Promise<void> {
		// Store the entry and update the index atomically
		const idx = (await this.storage.get<string[]>(KEY_IDX)) ?? [];
		idx.push(entry.id);

		const puts: Record<string, unknown> = {
			[`${ENTRY_PREFIX}${entry.id}`]: entry,
			[KEY_IDX]: idx,
		};

		// If it's a label entry, update the label index
		if (entry.type === "label") {
			if (entry.label !== undefined) {
				puts[`${LABEL_PREFIX}${entry.targetId}`] = entry.label;
			} else {
				await this.storage.delete(`${LABEL_PREFIX}${entry.targetId}`);
			}
		}

		// Advance the leaf pointer.
		//
		// A `leaf` entry explicitly repositions the leaf to its target (used by
		// navigation/branching). Every other content entry (message, model_change,
		// thinking_level_change, …) is appended with `parentId = currentLeaf` and
		// must itself become the new leaf, so the parent chain stays connected and
		// `getPathToRoot(leafId)` can reconstruct the conversation. Without this,
		// content entries are orphaned at the root and history is lost on reload.
		// `label` entries are metadata and never move the leaf.
		if (entry.type === "leaf") {
			puts[KEY_LEAF] = entry.targetId;
		} else if (entry.type !== "label") {
			puts[KEY_LEAF] = entry.id;
		}

		await this.storage.put(puts);
	}

	async getEntry(id: string): Promise<SessionTreeEntry | undefined> {
		return this.storage.get<SessionTreeEntry>(`${ENTRY_PREFIX}${id}`);
	}

	async findEntries<TType extends SessionTreeEntry["type"]>(
		type: TType,
	): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>> {
		const idx = (await this.storage.get<string[]>(KEY_IDX)) ?? [];
		if (idx.length === 0) return [];

		const keys = idx.map((id) => `${ENTRY_PREFIX}${id}`);
		const entries = await this.storage.get<SessionTreeEntry>(keys);

		const result: Array<Extract<SessionTreeEntry, { type: TType }>> = [];
		for (const id of idx) {
			const entry = entries.get(`${ENTRY_PREFIX}${id}`);
			if (entry?.type === type) {
				result.push(entry as Extract<SessionTreeEntry, { type: TType }>);
			}
		}
		return result;
	}

	async getLabel(id: string): Promise<string | undefined> {
		return this.storage.get<string>(`${LABEL_PREFIX}${id}`);
	}

	async getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]> {
		if (leafId === null) return [];

		// Walk the parentId chain from leaf to root
		const path: SessionTreeEntry[] = [];
		let currentId: string | null = leafId;

		while (currentId !== null) {
			const entry: SessionTreeEntry | undefined =
				await this.storage.get<SessionTreeEntry>(`${ENTRY_PREFIX}${currentId}`);
			if (!entry) break;
			path.push(entry);
			currentId = entry.parentId;
		}

		// Return root-first order
		path.reverse();
		return path;
	}

	async getEntries(): Promise<SessionTreeEntry[]> {
		const idx = (await this.storage.get<string[]>(KEY_IDX)) ?? [];
		if (idx.length === 0) return [];

		const keys = idx.map((id) => `${ENTRY_PREFIX}${id}`);
		const entries = await this.storage.get<SessionTreeEntry>(keys);

		const result: SessionTreeEntry[] = [];
		for (const id of idx) {
			const entry = entries.get(`${ENTRY_PREFIX}${id}`);
			if (entry) result.push(entry);
		}
		return result;
	}

	/**
	 * Delete all session data from DO storage.
	 */
	async deleteAll(): Promise<void> {
		await this.storage.deleteAll();
	}
}
