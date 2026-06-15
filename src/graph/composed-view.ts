import type { GraphView } from "./store.js";
import { OverlayStore } from "./overlay-store.js";

export type { GraphView };

// Module-level store singleton set by server init.
let _store: OverlayStore | null = null;

/** Called once by server setup to wire the global store. */
export function initComposedView(store: OverlayStore): void {
  _store = store;
}

/** Returns the composed view for a worktree, or null if no store is initialised or worktreeId is absent. */
export function composedView(worktreeId: string | null | undefined): GraphView | null {
  if (!worktreeId || !_store) return null;
  return _store.composedView(worktreeId);
}

/** Expose the underlying store (used by orchestrator / tests). */
export function getStore(): OverlayStore {
  if (!_store) _store = new OverlayStore();
  return _store;
}
