import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import type { AnalysisFragment } from "../analyzers/types.js";

export interface CacheKey {
  analyzerId: string;
  analyzerVersion: string;
  grammarVersion: string;
  contentHash: string;
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function serializeKey(k: CacheKey): string {
  return `${k.analyzerId}:${k.analyzerVersion}:${k.grammarVersion}:${k.contentHash}`;
}

export declare function getParseCache(): ParseCache;

/** Minimal cache interface for testing (no private SQLite fields required). */
export interface ICacheStore {
  get(key: CacheKey): AnalysisFragment | undefined;
  put(key: CacheKey, fragment: AnalysisFragment): void;
}

/** @deprecated Use ICacheStore */
export type ParseCacheInterface = ICacheStore;

export function makeCacheKey(
  analyzerId: string,
  analyzerVersion: string,
  grammarVersion: string,
  hash: string,
): CacheKey {
  return { analyzerId, analyzerVersion, grammarVersion, contentHash: hash };
}

const DEFAULT_MAX_ENTRIES = 50_000;

export class ParseCache implements ICacheStore {
  private db: DatabaseSync;
  private maxEntries: number;

  constructor(dbPath: string, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.db = new DatabaseSync(dbPath);
    this.maxEntries = maxEntries;
    this._init();
  }

  private _init(): void {
    this.db.exec(`PRAGMA journal_mode = WAL`);
    this.db.exec(`PRAGMA synchronous = NORMAL`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        accessed_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS cache_accessed ON cache(accessed_at)`);
  }

  get(key: CacheKey): AnalysisFragment | undefined {
    const k = serializeKey(key);
    const row = this.db
      .prepare("SELECT value FROM cache WHERE key = ?")
      .get(k) as { value: string } | undefined;
    if (!row) return undefined;
    this.db.prepare("UPDATE cache SET accessed_at = unixepoch() WHERE key = ?").run(k);
    return JSON.parse(row.value) as AnalysisFragment;
  }

  put(key: CacheKey, fragment: AnalysisFragment): void {
    const k = serializeKey(key);
    const v = JSON.stringify(fragment);
    this.db
      .prepare(
        `INSERT INTO cache (key, value, accessed_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, accessed_at = unixepoch()`,
      )
      .run(k, v);
    this._evict();
  }

  private _evict(): void {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM cache")
      .get() as { count: number };
    const count = row.count;
    if (count > this.maxEntries) {
      const toDelete = count - this.maxEntries;
      this.db
        .prepare(
          `DELETE FROM cache WHERE key IN (
            SELECT key FROM cache ORDER BY accessed_at ASC LIMIT ?
          )`,
        )
        .run(toDelete);
    }
  }

  close(): void {
    this.db.close();
  }
}
