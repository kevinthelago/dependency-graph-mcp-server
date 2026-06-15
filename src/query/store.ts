// Stub composedView — will be replaced by core-3 + qd-1.
// Provides per-worktree graph injection for tests.
// Self-contained so it doesn't conflict with the shared query/types.ts.

import type Graph from 'graphology';
import { DirectedGraph } from 'graphology';
import type { NodeAttrs, EdgeAttrs } from '../graph/model.js';

const views = new Map<string, Graph>();

/** Returns the composed graph view for the given worktree. */
export function composedView(worktreeId: string): Graph {
  return views.get(worktreeId) ?? new DirectedGraph<NodeAttrs, EdgeAttrs>({ type: 'directed', multi: true });
}

/** Test-only: inject a graph for a worktree id. */
export function _setTestView(worktreeId: string, graph: Graph): void {
  views.set(worktreeId, graph);
}

/** Test-only: remove all injected views. */
export function _clearTestViews(): void {
  views.clear();
}
