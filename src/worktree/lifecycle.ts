/**
 * wv-3: Overlay lifecycle — idle teardown, isolation, refresh, base-branch-move recompute.
 *
 * Teardown triggers:
 *  - Explicit disconnect (session disconnect callback)
 *  - Idle timeout (default 30 min, configurable)
 *
 * Refresh: re-run computeChangedFiles + seedOverlay from scratch.
 * Base-branch move: re-index base graph, then refresh all overlays.
 */

import type { WorktreeEntry } from "./registry.js";
import type { SeedOverlayOptions } from "./overlay.js";
import type { LanguageAnalyzer, ProjectContext } from "../analyzers/types.js";
import type { ICacheStore } from "../cache/index.js";
import type { Overlay } from "../graph/store.js";
import { computeChangedFiles } from "./diff.js";
import { seedOverlay } from "./overlay.js";

/** Configuration for the lifecycle manager. */
export interface LifecycleConfig {
  /** Idle timeout in milliseconds before teardown. Default: 30 minutes. */
  idleTimeoutMs?: number;
}

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Teardown callback — called when a worktree's overlay should be dropped. */
export type TeardownFn = (worktreeId: string) => void;

/**
 * Manages idle teardown timers for all registered worktrees.
 * One instance per server.
 */
export class LifecycleManager {
  private readonly idleTimeoutMs: number;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly onTeardown: TeardownFn;

  constructor(onTeardown: TeardownFn, config: LifecycleConfig = {}) {
    this.idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.onTeardown = onTeardown;
  }

  /** Reset the idle timer for a worktree (call on every activity). */
  touch(worktreeId: string): void {
    this.clearTimer(worktreeId);
    const timer = setTimeout(() => {
      this.timers.delete(worktreeId);
      this.onTeardown(worktreeId);
    }, this.idleTimeoutMs);
    // Allow Node to exit even if this timer is pending
    if (typeof timer.unref === "function") timer.unref();
    this.timers.set(worktreeId, timer);
  }

  /** Immediately trigger teardown for a worktree (e.g. session disconnect). */
  evict(worktreeId: string): void {
    this.clearTimer(worktreeId);
    this.onTeardown(worktreeId);
  }

  /** Cancel the idle timer without triggering teardown. */
  cancel(worktreeId: string): void {
    this.clearTimer(worktreeId);
  }

  dispose(): void {
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
  }

  private clearTimer(worktreeId: string): void {
    const t = this.timers.get(worktreeId);
    if (t !== undefined) {
      clearTimeout(t);
      this.timers.delete(worktreeId);
    }
  }
}

/** Options for refreshing a single worktree's overlay. */
export interface RefreshOptions {
  entry: WorktreeEntry;
  /** The overlay to clear and reseed — passed explicitly since WorktreeEntry is core-owned. */
  overlay: Overlay;
  repoRoot: string;
  getAnalyzer: (filePath: string) => LanguageAnalyzer | undefined;
  cache: ICacheStore;
  projectContext: ProjectContext;
}

/**
 * Recompute the overlay for one worktree from scratch.
 * Used by: re-registration, explicit refresh, base-branch-move.
 */
export async function refreshOverlay(opts: RefreshOptions): Promise<void> {
  const { entry, overlay, repoRoot, getAnalyzer, cache, projectContext } = opts;

  // Clear everything in the current overlay before reseeding
  for (const filePath of overlay.coveredFiles()) {
    overlay.clearFile(filePath);
  }

  const changedFiles = await computeChangedFiles(
    entry.worktreeRoot,
    entry.baseBranch,
    repoRoot,
  );

  const seedOpts: SeedOverlayOptions = {
    worktreeRoot: entry.worktreeRoot,
    repoRoot,
    baseBranch: entry.baseBranch,
    overlay,
    changedFiles,
    getAnalyzer,
    cache,
    projectContext,
  };

  await seedOverlay(seedOpts);
}
