import { DEFAULT_BULK_THRESHOLD } from './watcher.js';
import type { ChangeBatch } from './types.js';

export { DEFAULT_BULK_THRESHOLD };

/**
 * Returns true if the batch is large enough to warrant a full git-diff resync
 * rather than per-file incremental processing (lg-4).
 *
 * Threshold defaults to 50 files. Above this point, per-file incremental updates
 * are more expensive than a single seeding pass (e.g. after a branch switch or
 * mass rename). The caller is responsible for triggering the resync.
 */
export function isBulkBatch(
  batch: ChangeBatch,
  threshold = DEFAULT_BULK_THRESHOLD,
): boolean {
  return batch.length >= threshold;
}
