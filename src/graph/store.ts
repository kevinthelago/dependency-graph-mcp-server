import { DirectedGraph } from "graphology";
import type { NodeAttrs, EdgeAttrs, NodeId } from "./model.js";

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
