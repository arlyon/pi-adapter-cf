import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

export interface SessionMetadata {
	id: string;
	createdAt: string;
}

interface SessionTreeEntryBase {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export type SessionTreeEntry =
	| (SessionTreeEntryBase & { type: "message"; message: AgentMessage })
	| (SessionTreeEntryBase & {
			type: "thinking_level_change";
			thinkingLevel: string;
	  })
	| (SessionTreeEntryBase & {
			type: "model_change";
			provider: string;
			modelId: string;
	  })
	| (SessionTreeEntryBase & {
			type: "compaction";
			summary: string;
			firstKeptEntryId: string;
			tokensBefore: number;
			details?: unknown;
			fromHook?: boolean;
	  })
	| (SessionTreeEntryBase & {
			type: "branch_summary";
			fromId: string;
			summary: string;
			details?: unknown;
			fromHook?: boolean;
	  })
	| (SessionTreeEntryBase & {
			type: "custom";
			customType: string;
			data?: unknown;
	  })
	| (SessionTreeEntryBase & {
			type: "custom_message";
			customType: string;
			content: string | (TextContent | ImageContent)[];
			details?: unknown;
			display: boolean;
	  })
	| (SessionTreeEntryBase & {
			type: "label";
			targetId: string;
			label: string | undefined;
	  })
	| (SessionTreeEntryBase & { type: "session_info"; name?: string })
	| (SessionTreeEntryBase & { type: "leaf"; targetId: string | null });

export interface SessionTreeStorage {
	getMetadata(): Promise<SessionMetadata>;
	getLeafId(): Promise<string | null>;
	setLeafId(leafId: string | null): Promise<void>;
	createEntryId(): Promise<string>;
	appendEntry(entry: SessionTreeEntry): Promise<void>;
	getEntry(id: string): Promise<SessionTreeEntry | undefined>;
	findEntries<TType extends SessionTreeEntry["type"]>(
		type: TType,
	): Promise<Array<Extract<SessionTreeEntry, { type: TType }>>>;
	getLabel(id: string): Promise<string | undefined>;
	getPathToRoot(leafId: string | null): Promise<SessionTreeEntry[]>;
	getEntries(): Promise<SessionTreeEntry[]>;
}

function buildContext(path: SessionTreeEntry[]): { messages: AgentMessage[] } {
	const messages: AgentMessage[] = [];
	for (const entry of path) {
		if (entry.type === "message") messages.push(entry.message);
		else if (entry.type === "custom_message") {
			messages.push({
				role: "custom",
				customType: entry.customType,
				content: entry.content,
				display: entry.display,
				details: entry.details,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		} else if (entry.type === "branch_summary" && entry.summary) {
			messages.push({
				role: "branchSummary",
				summary: entry.summary,
				fromId: entry.fromId,
				timestamp: new Date(entry.timestamp).getTime(),
			});
		}
	}
	return { messages };
}

type PendingSessionTreeEntry = SessionTreeEntry extends infer TEntry
	? TEntry extends SessionTreeEntry
		? Omit<TEntry, "id" | "parentId" | "timestamp">
		: never
	: never;

export class SessionTree {
	private readonly storage: SessionTreeStorage;

	constructor(storage: SessionTreeStorage) {
		this.storage = storage;
	}

	getEntries(): Promise<SessionTreeEntry[]> {
		return this.storage.getEntries();
	}

	async getBranch(fromId?: string): Promise<SessionTreeEntry[]> {
		return this.storage.getPathToRoot(
			fromId ?? (await this.storage.getLeafId()),
		);
	}

	async buildContext(): Promise<{ messages: AgentMessage[] }> {
		return buildContext(await this.getBranch());
	}

	private async append(entry: PendingSessionTreeEntry): Promise<string> {
		const provisioned = {
			...entry,
			id: await this.storage.createEntryId(),
			parentId: await this.storage.getLeafId(),
			timestamp: new Date().toISOString(),
		} as SessionTreeEntry;
		await this.storage.appendEntry(provisioned);
		return provisioned.id;
	}

	appendMessage(message: AgentMessage): Promise<string> {
		return this.append({ type: "message", message });
	}

	async appendLabel(
		targetId: string,
		label: string | undefined,
	): Promise<string> {
		if (!(await this.storage.getEntry(targetId)))
			throw new Error(`Entry ${targetId} not found`);
		return this.append({ type: "label", targetId, label });
	}

	async moveTo(
		entryId: string | null,
		summary?: { summary: string; details?: unknown; fromHook?: boolean },
	): Promise<string | undefined> {
		if (entryId !== null && !(await this.storage.getEntry(entryId))) {
			throw new Error(`Entry ${entryId} not found`);
		}
		await this.storage.setLeafId(entryId);
		if (!summary) return undefined;
		return this.append({
			type: "branch_summary",
			fromId: entryId ?? "root",
			...summary,
		});
	}
}
