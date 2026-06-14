import Graph from "graphology";
import type { GNode, GEdge } from "./model.js";

export type GraphInstance = Graph<GNode, GEdge>;

/**
 * Read-only view over a composed graph (base + optional worktree overlay).
 * Consumers run queries through this interface; the real implementation is
 * provided by core-3 + qd-1 at runtime.
 */
export interface GraphView {
  hasNode(id: string): boolean;
  getNodeAttributes(id: string): GNode;
  /** All node IDs in this view. */
  nodes(): string[];
  /** Target node IDs of all outgoing edges from `id`. */
  outNeighbors(id: string): string[];
  /** True when a direct edge from → to exists (including self-loops). */
  hasEdge(from: string, to: string): boolean;
}

// ---------------------------------------------------------------------------
// Stub composedView — replaced by core-3 + qd-1 at runtime.
// ---------------------------------------------------------------------------

const views = new Map<string, GraphView>();

export function composedView(worktreeId: string): GraphView {
  const existing = views.get(worktreeId);
  if (existing !== undefined) return existing;
  return createGraphView(createGraph());
}

/** Test-only: inject a prepared view for a worktree ID. */
export function _setTestView(worktreeId: string, view: GraphView): void {
  views.set(worktreeId, view);
}

/** Test-only: reset all injected views. */
export function _clearTestViews(): void {
  views.clear();
}

// ---------------------------------------------------------------------------
// Graphology-backed helpers for tests.
// ---------------------------------------------------------------------------

export function createGraph(): GraphInstance {
  return new Graph<GNode, GEdge>({ type: "directed", allowSelfLoops: true, multi: true });
}

export function createGraphView(graph: GraphInstance): GraphView {
  return {
    hasNode: (id) => graph.hasNode(id),
    getNodeAttributes: (id) => graph.getNodeAttributes(id),
    nodes: () => graph.nodes(),
    outNeighbors: (id) => graph.outNeighbors(id),
    hasEdge: (from, to) => graph.hasEdge(from, to),
  };
}
