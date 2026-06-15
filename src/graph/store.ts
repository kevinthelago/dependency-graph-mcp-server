import { DirectedGraph } from "graphology";
import type { NodeAttrs, EdgeAttrs, NodeId, Node, Edge } from "./model.js";

export type GraphInstance = DirectedGraph<NodeAttrs, EdgeAttrs>;

/**
 * A read-only view over a composed graph (base + optional worktree overlay).
 * Consumers traverse this interface; the store manages the underlying graphology
 * instance and overlay merging.
 */
export interface GraphView {
  /** True if the node exists in this view. */
  hasNode(id: NodeId): boolean;
  /** Nodes that this node points TO (outgoing edges = this node depends on them). */
  outNeighbors(id: NodeId): NodeId[];
  /** Nodes that point TO this node (incoming edges = they depend on this node). */
  inNeighbors(id: NodeId): NodeId[];
  /** All neighbors (both directions). */
  neighbors(id: NodeId): NodeId[];
  /** Node attributes; throws if the node does not exist. */
  getNodeAttributes(id: NodeId): NodeAttrs;
  /** Iterate over all node IDs in the view. */
  nodes(): NodeId[];
  /** Total node count. */
  readonly order: number;
  /** Total edge count. */
  readonly size: number;
}

/** Minimal in-memory GraphView implementation backed by a graphology DiGraph. */
export function createGraphView(graph: GraphInstance): GraphView {
  return {
    hasNode: (id) => graph.hasNode(id),
    outNeighbors: (id) => graph.outNeighbors(id),
    inNeighbors: (id) => graph.inNeighbors(id),
    neighbors: (id) => graph.neighbors(id),
    getNodeAttributes: (id) => graph.getNodeAttributes(id),
    nodes: () => graph.nodes(),
    get order() {
      return graph.order;
    },
    get size() {
      return graph.size;
    },
  };
}

/** Build a fresh directed graphology instance. */
export function createGraph(): GraphInstance {
  return new DirectedGraph<NodeAttrs, EdgeAttrs>();
}

// ── Overlay engine (worktree-view stream) ──

/** A file-granularity slice produced by a language analyzer for the overlay. */
export interface FileSlice {
  file: Node;
  symbols: Node[];
  edges: Edge[];
}

/** Per-worktree overlay: file-level replacements layered over the base graph. */
export interface Overlay {
  /** Replace (or insert) all nodes/edges for a file. */
  applyFile(filePath: string, slice: FileSlice): void;
  /** Mark a file deleted so it is absent from the composed view. */
  deleteFile(filePath: string): void;
  /** Remove all data for a file (undo applyFile or deleteFile). */
  clearFile(filePath: string): void;
  /** True when no files have been modified/deleted relative to base. */
  isEmpty(): boolean;
  /** Return the set of file paths covered by this overlay. */
  coveredFiles(): ReadonlySet<string>;
}

import type { FileSlice } from './model.js';

/** Read-only view returned by GraphStore.composedView(). */
export interface StoreView {
  hasNode(id: NodeId): boolean;
  nodesForFile(filePath: string): Node[];
  getNodeAttributes(id: NodeId): NodeAttrs;
  forEachNode(cb: (id: NodeId, attrs: NodeAttrs) => void): void;
  forEachOutEdge(
    id: NodeId,
    cb: (edge: string, attrs: EdgeAttrs, src: NodeId, tgt: NodeId) => void,
  ): void;
  inDegree(id: NodeId): number;
  order: number;
  size: number;
}

/**
 * In-memory graph store: base slices + per-worktree overlays.
 * The core stream (core-3) will replace this with the full durable implementation.
 */
export class GraphStore {
  private readonly _base = new Map<string, FileSlice>();
  private readonly _overlays = new Map<string, Map<string, FileSlice | null>>();

  applyBaseSlice(slice: FileSlice): void {
    this._base.set(slice.filePath, slice);
  }

  applyOverlaySlice(worktreeId: string, slice: FileSlice): void {
    this._overlayFor(worktreeId).set(slice.filePath, slice);
  }

  markOverlayDeleted(worktreeId: string, filePath: string): void {
    this._overlayFor(worktreeId).set(filePath, null);
  }

  composedView(worktreeId: string): StoreView {
    const overlay = this._overlays.get(worktreeId) ?? new Map<string, FileSlice | null>();
    const composed = new Map<string, FileSlice>();
    for (const [fp, slice] of this._base) {
      if (!overlay.has(fp)) composed.set(fp, slice);
    }
    for (const [fp, slice] of overlay) {
      if (slice !== null) composed.set(fp, slice);
    }
    const allNodes = new Map<string, Node>();
    const allEdges: Array<{ src: string; tgt: string; attrs: EdgeAttrs }> = [];
    const fileNodes = new Map<string, Node[]>();
    for (const [fp, slice] of composed) {
      const fn: Node[] = [];
      for (const n of slice.nodes) {
        allNodes.set(n.id, n);
        fn.push(n);
      }
      fileNodes.set(fp, fn);
      for (const e of slice.edges) {
        allEdges.push({ src: e.from, tgt: e.to, attrs: { kind: 'imports' } });
      }
    }
    return {
      hasNode: (id) => allNodes.has(id),
      nodesForFile: (fp) => fileNodes.get(fp) ?? [],
      getNodeAttributes: (id) => {
        const n = allNodes.get(id);
        if (!n) throw new Error(`No node: ${id}`);
        return { kind: n.kind, filePath: n.file ?? id, displayName: n.name } as NodeAttrs;
      },
      forEachNode: (cb) => { for (const [id, n] of allNodes) cb(id, { kind: n.kind, filePath: n.file ?? id, displayName: n.name } as NodeAttrs); },
      forEachOutEdge: (_id, _cb) => {},
      inDegree: (_id) => 0,
      get order() { return allNodes.size; },
      get size() { return allEdges.length; },
    };
  }

  private _overlayFor(worktreeId: string): Map<string, FileSlice | null> {
    let m = this._overlays.get(worktreeId);
    if (!m) { m = new Map(); this._overlays.set(worktreeId, m); }
    return m;
  }
}

/** The graph store singleton — owned by core-3. */
export declare const graphStore: {
  createOverlay(worktreeId: string): Overlay;
  dropOverlay(worktreeId: string): void;
  composedView(worktreeId: string): GraphView;
};
