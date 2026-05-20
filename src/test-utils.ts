/**
 * Minimal mock of Cloudflare DurableObjectStorage for unit tests.
 * Backed by an in-memory Map.
 */
export class MockDurableObjectStorage {
	private data = new Map<string, unknown>();

	async get<T = unknown>(
		keyOrKeys: string | string[],
	): Promise<T | Map<string, T> | undefined> {
		if (Array.isArray(keyOrKeys)) {
			const result = new Map<string, T>();
			for (const key of keyOrKeys) {
				const value = this.data.get(key);
				if (value !== undefined) {
					result.set(key, value as T);
				}
			}
			return result as Map<string, T>;
		}
		return this.data.get(keyOrKeys) as T | undefined;
	}

	async put(keyOrEntries: string | Record<string, unknown>, value?: unknown) {
		if (typeof keyOrEntries === "string") {
			this.data.set(keyOrEntries, value);
		} else {
			for (const [k, v] of Object.entries(keyOrEntries)) {
				this.data.set(k, v);
			}
		}
	}

	async delete(keyOrKeys: string | string[]): Promise<boolean | number> {
		if (Array.isArray(keyOrKeys)) {
			let count = 0;
			for (const key of keyOrKeys) {
				if (this.data.delete(key)) count++;
			}
			return count;
		}
		return this.data.delete(keyOrKeys);
	}

	async deleteAll() {
		this.data.clear();
	}

	async setAlarm(_scheduledTime: number | Date) {
		// no-op for tests
	}

	async getAlarm(): Promise<number | null> {
		return null;
	}

	async deleteAlarm() {
		// no-op
	}

	/** Expose internal map for assertions. */
	get _raw() {
		return this.data;
	}
}
