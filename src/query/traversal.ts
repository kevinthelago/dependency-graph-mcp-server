import type { NodeId } from "../graph/model.js";
import type { GraphView } from "../graph/store.js";
import { nodeKind, displayName } from "../graph/node-id.js";
import type { TraversalEntry } from "./types.js";

export interface BfsOptions {
  /** Maximum hop depth. Unlimited when undefined. */
  maxDepth?: number;
  /** Whether to record one example path per node. Adds memory overhead. */
  includePaths?: boolean;
  /** Max entries to return before truncating. */
  limit?: number;
}

export interface BfsResult {
  entries: TraversalEntry[];
  truncated: boolean;
  /** Number of nodes discovered before truncation (including truncated nodes). */
  total: number;
}

/**
 * Reverse BFS from `origin`: discovers all nodes that (transitively) depend
 * ON origin, i.e. nodes from which there is a directed path to origin.
 *
 * Uses a visited set to handle cycles; each node is emitted exactly once at
 * its shortest distance.
 */
export function reverseBlastBfs(
  view: GraphView,
  origin: NodeId,
  opts: BfsOptions = {}
): BfsResult {
  const { maxDepth, includePaths, limit = 10_000 } = opts;

  const entries: TraversalEntry[] = [];
  const visited = new Set<NodeId>([origin]);

  // Queue entries: [nodeId, distance, pathFromOrigin]
  type QueueItem = {
    id: NodeId;
    distance: number;
    path: NodeId[] | null;
  };

  const queue: QueueItem[] = [];

  // Seed with direct in-neighbors of origin
  for (const neighbor of view.inNeighbors(origin)) {
    if (!visited.has(neighbor)) {
      visited.add(neighbor);
      queue.push({
        id: neighbor,
        distance: 1,
        path: includePaths ? [neighbor, origin] : null,
      });
    }
  }

  let qi = 0;
  let discoveredTotal = queue.length;

  while (qi < queue.length) {
    const item = queue[qi++];
    if (item === undefined) continue;

    const { id, distance, path } = item;

    entries.push({
      id,
      kind: nodeKind(id),
      displayName: displayName(id),
      distance,
      ...(path !== null ? { examplePath: path } : {}),
    });

    if (entries.length >= limit) {
      // Count remaining in queue as truncated
      return {
        entries,
        truncated: true,
        total: discoveredTotal,
      };
    }

    // Don't expand further if we've hit maxDepth
    if (maxDepth !== undefined && distance >= maxDepth) continue;

    for (const neighbor of view.inNeighbors(id)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        discoveredTotal++;
        queue.push({
          id: neighbor,
          distance: distance + 1,
          path: includePaths && path ? [neighbor, ...path] : null,
        });
      }
    }
  }

  return { entries, truncated: false, total: entries.length };
}
