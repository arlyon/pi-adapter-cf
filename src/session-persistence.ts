/**
 * pi-agent-cf — Session persistence via Durable Object storage
 *
 * Stores agent messages in DO transactional storage, splitting large
 * conversations into chunks to stay within the 128 KiB per-key limit.
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";

const CHUNK_PREFIX = "msgs:";
const META_KEY = "meta";
const MAX_CHUNK_BYTES = 100_000; // stay well under 128 KiB limit

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface SessionMeta {
  chunkCount: number;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

/**
 * Persist agent messages to Durable Object storage.
 * Messages are serialised to JSON and split across multiple keys
 * if needed to respect the per-key size limit.
 *
 * @param maxMessages  Truncate to this many most-recent messages before saving.
 */
export async function saveMessages(
  storage: DurableObjectStorage,
  messages: AgentMessage[],
  maxMessages = 200,
): Promise<void> {
  // Truncate old messages
  const trimmed = messages.length > maxMessages ? messages.slice(-maxMessages) : messages;

  // Serialise and chunk
  const chunks: string[] = [];
  let currentChunk: AgentMessage[] = [];
  let currentSize = 0;

  for (const msg of trimmed) {
    const serialised = JSON.stringify(msg);
    const byteLen = new TextEncoder().encode(serialised).byteLength;

    if (currentSize + byteLen > MAX_CHUNK_BYTES && currentChunk.length > 0) {
      chunks.push(JSON.stringify(currentChunk));
      currentChunk = [];
      currentSize = 0;
    }

    currentChunk.push(msg);
    currentSize += byteLen;
  }

  if (currentChunk.length > 0) {
    chunks.push(JSON.stringify(currentChunk));
  }

  // Delete old chunks that exceed new count
  const oldMeta = await storage.get<SessionMeta>(META_KEY);
  if (oldMeta) {
    const keysToDelete: string[] = [];
    for (let i = chunks.length; i < oldMeta.chunkCount; i++) {
      keysToDelete.push(`${CHUNK_PREFIX}${i}`);
    }
    if (keysToDelete.length > 0) {
      await storage.delete(keysToDelete);
    }
  }

  // Write all chunks + meta in a batch
  const entries = new Map<string, string | SessionMeta>();
  for (let i = 0; i < chunks.length; i++) {
    entries.set(`${CHUNK_PREFIX}${i}`, chunks[i]);
  }

  const now = Date.now();
  entries.set(META_KEY, {
    chunkCount: chunks.length,
    messageCount: trimmed.length,
    createdAt: oldMeta?.createdAt ?? now,
    updatedAt: now,
  } satisfies SessionMeta);

  await storage.put(Object.fromEntries(entries));
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/**
 * Restore agent messages from Durable Object storage.
 * Returns an empty array if no session data exists.
 */
export async function loadMessages(
  storage: DurableObjectStorage,
): Promise<AgentMessage[]> {
  const meta = await storage.get<SessionMeta>(META_KEY);
  if (!meta || meta.chunkCount === 0) return [];

  const keys = Array.from({ length: meta.chunkCount }, (_, i) => `${CHUNK_PREFIX}${i}`);
  const chunks = await storage.get<string>(keys);

  const messages: AgentMessage[] = [];
  for (let i = 0; i < meta.chunkCount; i++) {
    const raw = chunks.get(`${CHUNK_PREFIX}${i}`);
    if (raw) {
      try {
        const parsed: AgentMessage[] = JSON.parse(raw);
        messages.push(...parsed);
      } catch {
        // Skip corrupted chunks
      }
    }
  }

  return messages;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Remove all persisted session data from DO storage.
 */
export async function deleteSession(storage: DurableObjectStorage): Promise<void> {
  await storage.deleteAll();
}

// ---------------------------------------------------------------------------
// Has persisted data?
// ---------------------------------------------------------------------------

export async function hasPersistedSession(storage: DurableObjectStorage): Promise<boolean> {
  const meta = await storage.get<SessionMeta>(META_KEY);
  return meta !== undefined && meta.messageCount > 0;
}
