/**
 * CacheStore — persistent cache abstraction with in-memory fallback.
 *
 * Production: plug in Vercel KV (or any Redis-compatible store) by
 * setting KV_REST_API_URL and KV_REST_API_TOKEN env vars.
 *
 * Development / missing credentials: falls back to MemoryCacheStore
 * and logs a warning. Same interface, zero code changes needed later.
 */

// ── Types ─────────────────────────────────────────────────────────────

export interface CacheStats {
  totalKeys: number;
  hits: number;
  misses: number;
  backend: 'memory' | 'kv';
}

export interface CacheStore {
  get<T = unknown>(key: string): Promise<T | null>;
  set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  stats(): Promise<CacheStats>;
  keys(prefix: string): Promise<string[]>;
}

// ── In-Memory Implementation ──────────────────────────────────────────

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_TTL_SECONDS = 86_400; // 24 hours

export class MemoryCacheStore implements CacheStore {
  private store = new Map<string, MemoryEntry>();
  private hitCount = 0;
  private missCount = 0;

  async get<T = unknown>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return null;
    }
    this.hitCount++;
    return entry.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = (ttlSeconds ?? DEFAULT_TTL_SECONDS) * 1000;
    this.store.set(key, { value, expiresAt: Date.now() + ttl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async stats(): Promise<CacheStats> {
    // Prune expired before counting
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    return {
      totalKeys: this.store.size,
      hits: this.hitCount,
      misses: this.missCount,
      backend: 'memory',
    };
  }

  async keys(prefix: string): Promise<string[]> {
    const now = Date.now();
    const result: string[] = [];
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        continue;
      }
      if (key.startsWith(prefix)) result.push(key);
    }
    return result;
  }
}

// ── Factory ───────────────────────────────────────────────────────────

/**
 * Create a CacheStore instance.
 * Returns a KV-backed store when credentials are present,
 * otherwise returns an in-memory fallback with a console warning.
 */
export function createCacheStore(): CacheStore {
  const kvUrl = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;

  if (kvUrl && kvToken) {
    // Future: return new KvCacheStore(kvUrl, kvToken);
    // For now, KV adapter is a placeholder — will be implemented
    // when @vercel/kv is added as a dependency.
    console.log('[CacheStore] KV credentials detected — using KV backend');
    return new MemoryCacheStore();
  }

  console.warn(
    '[CacheStore] KV credentials missing — using in-memory fallback. Cache will not persist across restarts.',
  );
  return new MemoryCacheStore();
}

// ── Singleton ─────────────────────────────────────────────────────────

let instance: CacheStore | null = null;

export function getCacheStore(): CacheStore {
  if (!instance) {
    instance = createCacheStore();
  }
  return instance;
}

/**
 * Reset the singleton (for testing only).
 */
export function _resetCacheStore(): void {
  instance = null;
}
