import type { GraphView } from "../graph/store.js";
import { nodeKind, displayName } from "../graph/node-id.js";
import type { TraversalEntry } from "./types.js";

export interface ForwardBfsOptions {
  /** Maximum hop depth (1 = direct dependencies only). */
  maxDepth?: number;
  /** Whether to record one example path per node. */
  includePaths?: boolean;
  /** Maximum entries before truncating. Defaults to 10 000. */
  limit?: number;
}

export interface ForwardBfsResult {
  entries: TraversalEntry[];
  truncated: boolean;
  /** Total nodes discovered (including those past the limit). */
  total: number;
}

/**
 * Forward BFS from `origin`: discovers all nodes that `origin` (transitively)
 * depends on, i.e. nodes reachable via outgoing edges from origin.
 *
 * External nodes (kind="external") are included but never traversed further.
 * Uses a visited set to handle cycles; each node emitted exactly once at its
 * shortest distance.
 */
export function forwardBfs(
  view: GraphView,
  origin: string,
  opts: ForwardBfsOptions = {},
): ForwardBfsResult {
  const { maxDepth, includePaths, limit = 10_000 } = opts;

  const entries: TraversalEntry[] = [];
  const visited = new Set<string>([origin]);

  type QueueItem = { id: string; distance: number; path: string[] | null };
  const queue: QueueItem[] = [];

  for (const neighbor of view.outNeighbors(origin)) {
    if (!visited.has(neighbor)) {
      visited.add(neighbor);
      queue.push({
        id: neighbor,
        distance: 1,
        path: includePaths ? [origin, neighbor] : null,
      });
    }
  }

  let qi = 0;
  let discoveredTotal = queue.length;

  while (qi < queue.length) {
    const item = queue[qi++]!;
    const { id, distance, path } = item;

    const kind = nodeKind(id);

    entries.push({
      id,
      kind,
      displayName: displayName(id),
      distance,
      ...(path !== null ? { examplePath: path } : {}),
    });

    if (entries.length >= limit) {
      return { entries, truncated: true, total: discoveredTotal };
    }

    // External nodes are leaves — never traverse into them.
    if (kind === "external") continue;
    if (maxDepth !== undefined && distance >= maxDepth) continue;

    for (const neighbor of view.outNeighbors(id)) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        discoveredTotal++;
        queue.push({
          id: neighbor,
          distance: distance + 1,
          path: includePaths && path ? [...path, neighbor] : null,
        });
      }
    }
  }

  return { entries, truncated: false, total: entries.length };
}
