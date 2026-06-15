import chokidar, { type FSWatcher } from 'chokidar';
import { extname, dirname } from 'node:path';
import type { FileChange, ChangeBatch, WatcherOptions } from './types.js';

export const DEFAULT_DEBOUNCE_MS = 200;
export const DEFAULT_BULK_THRESHOLD = 50;

/** Glob patterns always excluded regardless of caller options. */
const BASE_IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__pycache__/**',
  '**/*.pyc',
  '**/*.pyo',
];

/**
 * Convert a glob string to a regex that matches against forward-slash normalized
 * paths. This handles Windows paths (backslash) correctly by normalizing before
 * testing — chokidar emits backslash paths on Windows which breaks glob strings.
 */
function globToRegex(glob: string): RegExp {
  const normalized = glob.replace(/\\/g, '/');
  let pattern = '';
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i]!;
    if (c === '*' && normalized[i + 1] === '*') {
      pattern += '.*';
      i += 2;
      if (normalized[i] === '/') i++;
    } else if (c === '*') {
      pattern += '[^/]*';
      i++;
    } else if (c === '?') {
      pattern += '[^/]';
      i++;
    } else {
      // Escape regex special chars other than * and ?
      pattern += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i++;
    }
  }
  // Case-insensitive on Windows; case-sensitive elsewhere.
  const flags = process.platform === 'win32' ? 'i' : '';
  return new RegExp(pattern, flags);
}

/**
 * Build a chokidar-compatible ignored function from glob strings.
 * Using a function ensures cross-platform path normalization.
 */
function buildIgnoredFn(globs: string[]): (p: string) => boolean {
  const regexes = globs.map(globToRegex);
  return (p: string) => {
    const normalized = p.replace(/\\/g, '/');
    return regexes.some((r) => r.test(normalized));
  };
}

type RawEventType = 'add' | 'change' | 'unlink';

interface PendingEntry {
  type: RawEventType;
  path: string;
}

/**
 * Wraps a chokidar FSWatcher for a single registered worktree.
 *
 * Events are coalesced into a 200 ms debounced batch before the consumer
 * callback fires. Within a batch, unlink+add pairs sharing the same directory
 * and extension are promoted to 'move' events (rename detection heuristic).
 *
 * Transient files (created and deleted within the same debounce window) are
 * silently dropped — they never existed as far as the graph is concerned.
 */
export class WorktreeWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last event per path — keyed by absolute path. */
  private readonly pending = new Map<string, PendingEntry>();
  private readonly debounceMs: number;

  constructor(
    /** Absolute root paths to watch (typically one per worktree). */
    private readonly roots: string[],
    private readonly options: WatcherOptions,
    /** Called with the coalesced batch after the debounce window expires. */
    private readonly onBatch: (batch: ChangeBatch) => Promise<void>,
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /** Start watching. Idempotent. */
  start(): void {
    if (this.watcher !== null) return;

    const allGlobs = [...BASE_IGNORED, ...(this.options.ignored ?? [])];
    // Use a function-based ignored to handle Windows backslash paths correctly.
    const ignoredFn = buildIgnoredFn(allGlobs);

    this.watcher = chokidar.watch(this.roots, {
      ignored: ignoredFn,
      persistent: true,
      ignoreInitial: true,
      // Let writes stabilize before emitting 'add'/'change'.
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 50 },
    });

    this.watcher.on('add', (p) => this.onRaw('add', p));
    this.watcher.on('change', (p) => this.onRaw('change', p));
    this.watcher.on('unlink', (p) => this.onRaw('unlink', p));
  }

  /** Stop watching and flush any pending events. */
  async stop(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.pending.size > 0) {
      await this.flush();
    }
    if (this.watcher !== null) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private onRaw(type: RawEventType, filePath: string): void {
    const existing = this.pending.get(filePath);

    if (existing !== undefined) {
      // Transient file: created and deleted before the window expires — drop it.
      if (existing.type === 'add' && type === 'unlink') {
        this.pending.delete(filePath);
        this.reschedule();
        return;
      }
      // add + change → still an add (file is new to the graph).
      if (existing.type === 'add' && type === 'change') {
        this.reschedule();
        return;
      }
    }

    this.pending.set(filePath, { type, path: filePath });
    this.reschedule();
  }

  private reschedule(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush().catch(() => {
        // Errors propagate to the caller via onBatch; nothing more to do here.
      });
    }, this.debounceMs);
  }

  private async flush(): Promise<void> {
    const entries = [...this.pending.values()];
    this.pending.clear();
    if (entries.length === 0) return;
    const batch = coalesceMoves(entries);
    await this.onBatch(batch);
  }
}

/**
 * Promotes unlink+add pairs that share the same directory and file extension to
 * 'move' events (common rename pattern on all platforms).
 *
 * Limitation: pairs across directories or with different extensions remain as
 * separate unlink + add events. False positives (unrelated delete+create in the
 * same dir/ext) are theoretically possible but rare within a 200 ms window.
 */
export function coalesceMoves(entries: readonly PendingEntry[]): ChangeBatch {
  const adds: PendingEntry[] = [];
  const changes: PendingEntry[] = [];
  const unlinks: PendingEntry[] = [];

  for (const e of entries) {
    if (e.type === 'add') adds.push(e);
    else if (e.type === 'change') changes.push(e);
    else unlinks.push(e);
  }

  const result: FileChange[] = [];
  const usedAddPaths = new Set<string>();
  const usedUnlinkPaths = new Set<string>();

  for (const ul of unlinks) {
    const ulDir = dirname(ul.path);
    const ulExt = extname(ul.path);

    const match = adds.find(
      (a) =>
        !usedAddPaths.has(a.path) &&
        dirname(a.path) === ulDir &&
        extname(a.path) === ulExt,
    );

    if (match !== undefined) {
      result.push({ type: 'move', path: match.path, oldPath: ul.path });
      usedAddPaths.add(match.path);
      usedUnlinkPaths.add(ul.path);
    }
  }

  for (const ul of unlinks) {
    if (!usedUnlinkPaths.has(ul.path)) {
      result.push({ type: 'unlink', path: ul.path });
    }
  }
  for (const a of adds) {
    if (!usedAddPaths.has(a.path)) {
      result.push({ type: 'add', path: a.path });
    }
  }
  for (const c of changes) {
    result.push({ type: 'change', path: c.path });
  }

  return result;
}
