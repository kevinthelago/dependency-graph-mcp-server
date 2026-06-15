import type { GraphStore, WorktreeId } from "../graph/store.js";
import type { AnalysisFragment } from "../analyzers/types.js";
import type { FileSlice } from "../graph/model.js";
import { makeFileId } from "../graph/node-id.js";

function fragmentToSlice(
  filePath: string,
  fragment: AnalysisFragment,
): FileSlice {
  return {
    filePath,
    nodes: [fragment.file, ...fragment.symbols],
    edges: fragment.edges,
  };
}

/**
 * Apply a file's analysis fragment to the base graph.
 * Atomically replaces the file's slice (stale-edge removal is handled by
 * store.applyBaseSlice which drops the old nodes/edges first).
 */
export function applyBaseFile(
  store: GraphStore,
  filePath: string,
  fragment: AnalysisFragment,
): void {
  const slice = fragmentToSlice(filePath, fragment);
  store.applyBaseSlice(slice);
}

/**
 * Remove a file's slice from the base graph.
 */
export function removeBaseFile(store: GraphStore, filePath: string): void {
  store.removeBaseSlice(filePath);
}

/**
 * Apply a file's analysis fragment to a worktree overlay.
 */
export function applyOverlayFile(
  store: GraphStore,
  worktreeId: WorktreeId,
  filePath: string,
  fragment: AnalysisFragment,
): void {
  const slice = fragmentToSlice(filePath, fragment);
  store.applyOverlaySlice(worktreeId, slice);
}

/**
 * Mark a file as deleted in a worktree overlay.
 */
export function removeOverlayFile(
  store: GraphStore,
  worktreeId: WorktreeId,
  filePath: string,
): void {
  store.markOverlayDeleted(worktreeId, filePath);
}

export { makeFileId };
