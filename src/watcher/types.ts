/** A file change type emitted by the watcher. Move = rename within or across dirs. */
export type FileChangeType = 'add' | 'change' | 'unlink' | 'move';

export interface FileChange {
  type: FileChangeType;
  /** Absolute path of the affected file (new path for move). */
  path: string;
  /** Absolute path of the old file location — only present when type === 'move'. */
  oldPath?: string;
}

/** A debounced batch of coalesced file-system changes. */
export type ChangeBatch = FileChange[];

export interface WatcherOptions {
  /**
   * Glob patterns to ignore, relative to the watched roots.
   * Merged with the built-in defaults (node_modules, .git, dist, build, …).
   */
  ignored?: string[];
  /** Debounce window in milliseconds (default: 200). */
  debounceMs?: number;
  /** File batch size above which a bulk resync is preferred (default: 50). */
  bulkThreshold?: number;
}
