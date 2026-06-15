import { relative } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ChangeBatch } from '../watcher/index.js';
import { isBulkBatch } from '../watcher/index.js';
import type { Overlay, OverlaySlice } from '../graph/store.js';
import type { CacheKey, ParseCache } from '../cache/index.js';
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext } from '../analyzers/types.js';

/** Minimal cache interface; structurally satisfied by ParseCache and in-memory stubs. */
export interface CacheAccess {
  get(key: CacheKey): AnalysisFragment | undefined;
  put(key: CacheKey, fragment: AnalysisFragment): void;
}

export interface IncrementalContext {
  worktreeRoot: string;
  repoRoot: string;
  baseBranch: string;
  overlay: Overlay;
  getAnalyzer(absPath: string): LanguageAnalyzer | undefined;
  cache: CacheAccess;
  projectContext: ProjectContext;
  /**
   * Override the bulk-resync implementation (useful for testing).
   * When omitted, falls back to computeChangedFiles + seedOverlay from
   * worktree/diff and worktree/overlay (loaded via dynamic import so this
   * module can be loaded before those files exist in develop).
   */
  doBulkResync?(ctx: IncrementalContext): Promise<void>;
}

export interface IncrementalResult {
  /** Node IDs of files/symbols that changed (empty for bulk resyncs). */
  changedNodeIds: string[];
  wasBulk: boolean;
}

/**
 * Analyze one file (cache-first) and apply its slice to the overlay.
 * Returns the node IDs for the file node and all its symbol nodes.
 * Treats read errors as deletes (file disappeared between event and processing).
 */
export async function analyzeAndApply(
  absPath: string,
  relPath: string,
  overlay: Overlay,
  analyzer: LanguageAnalyzer,
  cache: CacheAccess,
  projectContext: ProjectContext,
): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(absPath, 'utf8');
  } catch {
    overlay.deleteFile(relPath);
    return [];
  }

  const hash = createHash('sha256').update(text, 'utf8').digest('hex');
  const key: CacheKey = {
    analyzerId: analyzer.id,
    analyzerVersion: analyzer.version,
    grammarVersion: 'n/a',
    contentHash: hash,
  };

  let fragment: AnalysisFragment | undefined = cache.get(key);
  if (!fragment) {
    fragment = await analyzer.analyzeFile(relPath, text);
    cache.put(key, fragment);
  }

  const slice: OverlaySlice = {
    file: fragment.file,
    symbols: fragment.symbols,
    edges: fragment.edges,
  };
  overlay.applyFile(relPath, slice);

  const nodeIds: string[] = [fragment.file.id];
  for (const sym of fragment.symbols) {
    nodeIds.push(sym.id);
  }
  return nodeIds;
}

function toRelPath(absPath: string, worktreeRoot: string): string {
  return relative(worktreeRoot, absPath).replace(/\\/g, '/');
}

/**
 * Process a debounced file-change batch for a worktree.
 *
 * Small batches (< 50 files): per-file incremental — stale edges are removed
 * automatically because overlay.applyFile replaces the entire file slice.
 *
 * Large batches (>= 50 files): full overlay resync via git diff (lg-4).
 * Clearing + reseeding is cheaper than per-file incremental at that scale.
 */
export async function processIncrementalBatch(
  batch: ChangeBatch,
  ctx: IncrementalContext,
): Promise<IncrementalResult> {
  if (isBulkBatch(batch)) {
    const resync = ctx.doBulkResync ?? defaultBulkResync;
    await resync(ctx);
    return { changedNodeIds: [], wasBulk: true };
  }

  const changedNodeIds: string[] = [];

  for (const change of batch) {
    const relPath = toRelPath(change.path, ctx.worktreeRoot);

    if (change.type === 'unlink') {
      ctx.overlay.deleteFile(relPath);
      continue;
    }

    if (change.type === 'move') {
      const oldAbsPath = change.oldPath;
      if (oldAbsPath !== undefined) {
        const oldRelPath = toRelPath(oldAbsPath, ctx.worktreeRoot);
        ctx.overlay.deleteFile(oldRelPath);
      }
    }

    // add, change, or move (new path)
    const analyzer = ctx.getAnalyzer(change.path);
    if (analyzer) {
      const ids = await analyzeAndApply(
        change.path,
        relPath,
        ctx.overlay,
        analyzer,
        ctx.cache,
        ctx.projectContext,
      );
      changedNodeIds.push(...ids);
    }
  }

  return { changedNodeIds, wasBulk: false };
}

/**
 * Default bulk-resync implementation: clears the overlay and reseeds from
 * the git diff between the worktree and its base branch.
 *
 * Uses dynamic imports so this module can be loaded before worktree/diff.ts
 * and worktree/overlay.ts exist in the merged develop tree.
 */
async function defaultBulkResync(ctx: IncrementalContext): Promise<void> {
  for (const filePath of ctx.overlay.coveredFiles()) {
    ctx.overlay.clearFile(filePath);
  }

  // Dynamic imports keep this module self-contained until develop is merged.
  const { computeChangedFiles } = await import('../worktree/diff.js');
  const { seedOverlay } = await import('../worktree/overlay.js');

  const changedFiles = await computeChangedFiles(
    ctx.worktreeRoot,
    ctx.baseBranch,
    ctx.repoRoot,
  );

  await seedOverlay({
    worktreeRoot: ctx.worktreeRoot,
    repoRoot: ctx.repoRoot,
    baseBranch: ctx.baseBranch,
    overlay: ctx.overlay,
    changedFiles,
    getAnalyzer: ctx.getAnalyzer,
    cache: ctx.cache as ParseCache,
    projectContext: ctx.projectContext,
  });
}
