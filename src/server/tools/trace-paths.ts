import { z } from 'zod';
import type { GraphView } from '../../graph/store.js';
import { resolveTarget, type TargetSpec } from '../../query/resolve.js';
import { composedView } from '../../query/store.js';

interface GNode {
  id: string;
  kind: 'file' | 'symbol' | 'external';
  name: string;
}

interface GEdge {
  from: string;
  to: string;
  kind: 'import' | 'reference';
  targetType: 'file' | 'symbol' | 'external';
  typeOnly?: boolean;
  wildcard?: boolean;
  resolution: 'resolved' | 'unresolved';
  loc?: { line: number; col: number };
}

// ─── Input schema ─────────────────────────────────────────────────────────────

const TargetSpecSchema = z.union([
  z.object({ nodeId: z.string() }),
  z.object({ path: z.string(), symbol: z.string().optional() }),
]);

export const inputSchema = z.object({
  from: TargetSpecSchema,
  to: TargetSpecSchema,
  /** Follow edge direction (forward = from depends on to). */
  direction: z.enum(['forward', 'reverse', 'any']).default('forward'),
  /** Number of distinct shortest paths to return. */
  k: z.number().int().min(1).max(20).default(1),
  /** Maximum path length (hop count) to explore. */
  maxDepth: z.number().int().min(1).optional(),
  /** Attach source locations to each path edge. */
  includeLocations: z.boolean().default(false),
});

export type TracePathsInput = z.infer<typeof inputSchema>;

// ─── Result types ─────────────────────────────────────────────────────────────

export interface PathNode {
  id: string;
  kind: 'file' | 'symbol' | 'external';
  name: string;
}

export interface PathEdge {
  /** Actual source node in the underlying graph. */
  from: string;
  /** Actual target node in the underlying graph. */
  to: string;
  kind: 'import' | 'reference';
  targetType: 'file' | 'symbol' | 'external';
  loc?: { line: number; col: number };
}

export interface TracedPath {
  nodes: PathNode[];
  edges: PathEdge[];
}

export type TracePathsResult =
  | { found: false }
  | { found: false; candidates: string[] }
  | { self: true; node: PathNode }
  | { paths: TracedPath[]; truncated?: true };

export interface ToolContext {
  worktreeId: string;
}

// ─── Graph traversal helpers ──────────────────────────────────────────────────

const VISIT_BUDGET = 50_000;

function neighbors(
  graph: GraphView,
  node: string,
  direction: 'forward' | 'reverse' | 'any',
): string[] {
  if (direction === 'forward') return graph.outNeighbors(node);
  if (direction === 'reverse') return graph.inNeighbors(node);
  // any — union of both, deduplicated
  const seen = new Set(graph.outNeighbors(node));
  for (const n of graph.inNeighbors(node)) seen.add(n);
  return [...seen] as string[];
}

/**
 * BFS-based k-shortest simple paths.
 *
 * Explores the graph breadth-first (shortest paths first) and collects up to k
 * distinct paths from `from` to `to`, skipping any path that revisits a node
 * (cycle-safe). A visit budget caps total work; exceeding it sets `truncated`.
 */
function findKShortestSimplePaths(
  graph: GraphView,
  from: string,
  to: string,
  k: number,
  direction: 'forward' | 'reverse' | 'any',
  maxDepth: number | undefined,
): { paths: string[][]; truncated: boolean } {
  const results: string[][] = [];

  // Queue entries: the current path + the set of visited node ids
  const queue: Array<{ path: string[]; visited: Set<string> }> = [
    { path: [from], visited: new Set([from]) },
  ];

  let visits = 0;
  let truncated = false;

  while (queue.length > 0 && results.length < k) {
    if (++visits > VISIT_BUDGET) {
      truncated = true;
      break;
    }

    const { path, visited } = queue.shift()!;
    const current = path[path.length - 1]!;

    // Depth limit: path.length - 1 = hop count so far
    if (maxDepth !== undefined && path.length - 1 >= maxDepth) continue;

    for (const neighbor of neighbors(graph, current, direction)) {
      if (visited.has(neighbor)) continue; // simple paths only

      if (neighbor === to) {
        results.push([...path, neighbor]);
        if (results.length >= k) break;
      } else {
        queue.push({
          path: [...path, neighbor],
          visited: new Set([...visited, neighbor]),
        });
      }
    }
  }

  return { paths: results, truncated };
}

// ─── Result serialization ─────────────────────────────────────────────────────

function serializeNode(graph: GraphView, id: string): PathNode {
  const attrs = graph.getNodeAttributes(id) as Partial<GNode>;
  return {
    id,
    kind: attrs.kind ?? 'file',
    name: attrs.name ?? id,
  };
}

/**
 * For each consecutive pair in the traversed path, find the corresponding
 * directed edge in the underlying graph and serialize its metadata.
 *
 * For `reverse` traversal, the traversal goes from→neighbor via in-edges, so
 * the actual graph edge runs neighbor→from (we flip to recover the real edge).
 * For `any`, we check whichever direction the edge exists in.
 */
function serializeEdge(
  graph: GraphView,
  traversedFrom: string,
  traversedTo: string,
  direction: 'forward' | 'reverse' | 'any',
  includeLocations: boolean,
): PathEdge {
  let src: string;
  let dst: string;

  if (direction === 'reverse') {
    src = traversedTo;
    dst = traversedFrom;
  } else if (direction === 'any') {
    // Pick whichever direction the edge actually exists in
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    src = (graph as any).directedEdges(traversedFrom, traversedTo).length > 0
      ? traversedFrom
      : traversedTo;
    dst = src === traversedFrom ? traversedTo : traversedFrom;
  } else {
    src = traversedFrom;
    dst = traversedTo;
  }

  // directedEdges / getEdgeAttributes are graphology internals not on GraphView.
  // The stub composedView returns a raw graphology Graph, so these exist at runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edgeKeys: string[] = (graph as any).directedEdges(src, dst) as string[];
  const firstEdge = edgeKeys[0];
  if (edgeKeys.length === 0 || firstEdge === undefined) {
    // Defensive fallback; shouldn't happen on a consistent graph
    return { from: src, to: dst, kind: 'import', targetType: 'file' };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attrs = (graph as any).getEdgeAttributes(firstEdge) as Partial<GEdge>;
  const edge: PathEdge = {
    from: src,
    to: dst,
    kind: attrs.kind ?? 'import',
    targetType: attrs.targetType ?? 'file',
  };

  if (includeLocations && attrs.loc) edge.loc = attrs.loc;

  return edge;
}

function buildTracedPath(
  graph: GraphView,
  nodeIds: string[],
  direction: 'forward' | 'reverse' | 'any',
  includeLocations: boolean,
): TracedPath {
  const nodes = nodeIds.map((id) => serializeNode(graph, id));
  const edges: PathEdge[] = [];
  for (let i = 0; i < nodeIds.length - 1; i++) {
    edges.push(serializeEdge(graph, nodeIds[i]!, nodeIds[i + 1]!, direction, includeLocations));
  }
  return { nodes, edges };
}

// ─── Tool handler ─────────────────────────────────────────────────────────────

export async function handleTracePaths(
  input: TracePathsInput,
  ctx: ToolContext,
): Promise<TracePathsResult> {
  const graph = composedView(ctx.worktreeId) as unknown as GraphView;

  // Cast needed: Zod infers `symbol?: string | undefined` but TargetSpec uses exactOptionalPropertyTypes.
  const fromResult = resolveTarget(graph, input.from as TargetSpec);
  const toResult = resolveTarget(graph, input.to as TargetSpec);

  // Unresolvable endpoints — return not-found; candidates win over notFound
  if ('candidates' in fromResult) return { found: false, candidates: fromResult.candidates };
  if ('notFound' in fromResult) return { found: false };
  if ('candidates' in toResult) return { found: false, candidates: toResult.candidates };
  if ('notFound' in toResult) return { found: false };

  const fromId = fromResult.id;
  const toId = toResult.id;

  // Trivial case: from === to → single-node path
  if (fromId === toId) {
    return { self: true, node: serializeNode(graph, fromId) };
  }

  const { paths: rawPaths, truncated } = findKShortestSimplePaths(
    graph,
    fromId,
    toId,
    input.k,
    input.direction,
    input.maxDepth,
  );

  if (rawPaths.length === 0) return { found: false };

  const paths = rawPaths.map((p) =>
    buildTracedPath(graph, p, input.direction, input.includeLocations),
  );

  const result: TracePathsResult = { paths };
  if (truncated) (result as { paths: TracedPath[]; truncated?: true }).truncated = true;
  return result;
}

// ─── Tool registration helper ─────────────────────────────────────────────────

/** Name and schema exported so core-6 can register the MCP tool. */
export const toolName = 'trace_paths' as const;
export const toolInputSchema = inputSchema;
