/**
 * Parse cache — better-sqlite3-backed, content-keyed, LRU-evicting.
 * Owned by core-4.
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { AnalysisFragment } from '../analyzers/types.js';

export interface CacheKey {
  analyzerId: string;
  analyzerVersion: string;
  grammarVersion: string;
  contentHash: string;
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class ParseCache {
  private readonly _db: Database.Database;
  private readonly _max: number;

  constructor(dbPath: string, maxEntries = Infinity) {
    this._max = maxEntries;
    this._db = new Database(dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        inserted_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS cache_time ON cache(inserted_at);
    `);
  }

  get(key: CacheKey): AnalysisFragment | undefined {
    const k = serializeKey(key);
    const row = this._db.prepare('SELECT value FROM cache WHERE key = ?').get(k) as
      | { value: string }
      | undefined;
    if (!row) return undefined;
    return JSON.parse(row.value) as AnalysisFragment;
  }

  put(key: CacheKey, fragment: AnalysisFragment): void {
    const k = serializeKey(key);
    this._db
      .prepare('INSERT OR REPLACE INTO cache (key, value, inserted_at) VALUES (?, ?, ?)')
      .run(k, JSON.stringify(fragment), Date.now());
    this._evict();
  }

  close(): void {
    this._db.close();
  }

  private _evict(): void {
    if (!isFinite(this._max)) return;
    const { n } = this._db.prepare('SELECT COUNT(*) AS n FROM cache').get() as { n: number };
    const excess = n - this._max;
    if (excess > 0) {
      this._db
        .prepare(
          'DELETE FROM cache WHERE key IN (SELECT key FROM cache ORDER BY inserted_at ASC LIMIT ?)',
        )
        .run(excess);
    }
  }
}

function serializeKey(k: CacheKey): string {
  return `${k.analyzerId}:${k.analyzerVersion}:${k.grammarVersion}:${k.contentHash}`;
}

export declare function getParseCache(): ParseCache;

export function makeCacheKey(
  analyzerId: string,
  analyzerVersion: string,
  grammarVersion: string,
  hash: string,
): string {
  return `${analyzerId}:${analyzerVersion}:${grammarVersion}:${hash}`;
}
