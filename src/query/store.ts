// Stub composedView — will be replaced by core-3 + qd-1.
// Provides per-worktree graph injection for tests.
// Self-contained so it doesn't conflict with the shared query/types.ts.

import Graph from 'graphology';
import type { GraphView } from '../graph/store.js';

const views = new Map<string, Graph>();

/** Returns the composed graph view for the given worktree. */
export function composedView(worktreeId: string): GraphView {
  const g = views.get(worktreeId) ?? new Graph({ type: 'directed', multi: true });
  return g as unknown as GraphView;
}

/** Test-only: inject a graph for a worktree id. */
export function _setTestView(worktreeId: string, graph: Graph): void {
  views.set(worktreeId, graph);
}

/** Test-only: remove all injected views. */
export function _clearTestViews(): void {
  views.clear();
}
