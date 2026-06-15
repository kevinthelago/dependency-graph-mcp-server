import { z } from 'zod';
import { composedView } from '../../graph/composed-view.js';
import { resolveTarget } from '../../query/resolve.js';

interface GraphView {
  getNodeAttributes(id: string): Record<string, unknown>;
  getEdgeAttributes(edge: string): Record<string, unknown>;
  hasNode(id: string): boolean;
  forEachInEdge(
    node: string,
    cb: (edge: string, attrs: Record<string, unknown>, source: string, target: string) => void
  ): void;
  forEachOutEdge(
    node: string,
    cb: (edge: string, attrs: Record<string, unknown>, source: string, target: string) => void
  ): void;
}

export interface SerializedNode {
  id: string;
  kind: 'file' | 'symbol' | 'external';
  language: string | null;
  name: string;
  symbolKind?: string;
  file?: string;
  loc?: { line: number; col: number };
  exported?: boolean;
}

export interface SerializedEdge {
  from: string;
  to: string;
  kind: string;
  targetType: string;
  resolution: string;
  typeOnly?: boolean;
  wildcard?: boolean;
  loc?: { line: number; col: number };
}

export interface NeighborEntry {
  node: SerializedNode;
  edges: SerializedEdge[];
}

interface ToolContext {
  worktreeId: string;
}

const TargetSchema = z.union([
  z.object({ nodeId: z.string() }),
  z.object({ path: z.string() }),
  z.object({ path: z.string(), symbol: z.string() }),
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const GetNeighborsInput = z.object({
  target: TargetSchema.describe('Node whose neighbors to return'),
  direction: z
    .enum(['in', 'out', 'both'])
    .default('both')
    .describe('Which edges to follow: incoming, outgoing, or both'),
  includeLocations: z
    .boolean()
    .default(false)
    .describe('Include source locations on edges (and nodes) when available'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('Max unique neighbor nodes to return across in+out (1–200)'),
});

function serializeNode(
  id: string,
  attrs: Record<string, unknown>,
  includeLocations: boolean
): SerializedNode {
  const node: SerializedNode = {
    id,
    kind: attrs.kind as SerializedNode['kind'],
    language: (attrs.language as string | null) ?? null,
    name: attrs.name as string,
  };
  if (attrs.symbolKind !== undefined) node.symbolKind = attrs.symbolKind as string;
  if (attrs.file !== undefined) node.file = attrs.file as string;
  if (includeLocations && attrs.loc !== undefined) {
    node.loc = attrs.loc as NonNullable<SerializedNode['loc']>;
  }
  if (attrs.exported !== undefined) node.exported = attrs.exported as boolean;
  return node;
}

function serializeEdge(
  edge: string,
  attrs: Record<string, unknown>,
  source: string,
  target: string,
  includeLocations: boolean
): SerializedEdge {
  const e: SerializedEdge = {
    from: source,
    to: target,
    kind: attrs.kind as string,
    targetType: attrs.targetType as string,
    resolution: attrs.resolution as string,
  };
  if (attrs.typeOnly !== undefined) e.typeOnly = attrs.typeOnly as boolean;
  if (attrs.wildcard !== undefined) e.wildcard = attrs.wildcard as boolean;
  if (includeLocations && attrs.loc !== undefined) {
    e.loc = attrs.loc as NonNullable<SerializedEdge['loc']>;
  }
  return e;
}

/**
 * Collect 1-hop neighbors grouped by neighbor node id.
 * Returns a map of neighborId → { node, edges[] }, preserving multigraph edges.
 */
function collectNeighbors(
  view: GraphView,
  nodeId: string,
  direction: 'in' | 'out' | 'both',
  includeLocations: boolean
): { inMap: Map<string, NeighborEntry>; outMap: Map<string, NeighborEntry> } {
  const inMap = new Map<string, NeighborEntry>();
  const outMap = new Map<string, NeighborEntry>();

  if (direction === 'in' || direction === 'both') {
    view.forEachInEdge(nodeId, (edge, attrs, source, target) => {
      const entry = inMap.get(source) ?? {
        node: serializeNode(source, view.getNodeAttributes(source), includeLocations),
        edges: [],
      };
      entry.edges.push(serializeEdge(edge, attrs, source, target, includeLocations));
      inMap.set(source, entry);
    });
  }

  if (direction === 'out' || direction === 'both') {
    view.forEachOutEdge(nodeId, (edge, attrs, source, target) => {
      const entry = outMap.get(target) ?? {
        node: serializeNode(target, view.getNodeAttributes(target), includeLocations),
        edges: [],
      };
      entry.edges.push(serializeEdge(edge, attrs, source, target, includeLocations));
      outMap.set(target, entry);
    });
  }

  return { inMap, outMap };
}

export async function getNeighborsHandler(
  input: z.infer<typeof GetNeighborsInput>,
  ctx: ToolContext
) {
  const view = composedView(ctx.worktreeId) as GraphView | null;
  if (!view) {
    return { error: 'no_worktree' as const, message: 'No worktree registered for this session.' };
  }

  const resolved = resolveTarget(view as any, input.target) as
    | { id: string }
    | { candidates: string[] }
    | { notFound: true };

  if ('notFound' in resolved) {
    return { found: false as const };
  }
  if ('candidates' in resolved) {
    return { found: false as const, candidates: resolved.candidates };
  }

  const { id: nodeId } = resolved;
  const { inMap, outMap } = collectNeighbors(
    view,
    nodeId,
    input.direction,
    input.includeLocations
  );

  // Deterministic order within each list: sort by neighbor node id
  const sortById = (a: NeighborEntry, b: NeighborEntry) =>
    a.node.id.localeCompare(b.node.id);

  const allIn = Array.from(inMap.values()).sort(sortById);
  const allOut = Array.from(outMap.values()).sort(sortById);
  const total = allIn.length + allOut.length;

  // Split limit between in and out; if direction is one-sided, give it the full limit
  let inLimit: number;
  let outLimit: number;
  if (input.direction === 'in') {
    inLimit = input.limit;
    outLimit = 0;
  } else if (input.direction === 'out') {
    inLimit = 0;
    outLimit = input.limit;
  } else {
    inLimit = Math.ceil(input.limit / 2);
    outLimit = Math.floor(input.limit / 2);
    // Donate unused slots from the smaller side to the larger side
    const inSlack = Math.max(0, inLimit - allIn.length);
    const outSlack = Math.max(0, outLimit - allOut.length);
    inLimit = Math.min(allIn.length, inLimit + outSlack);
    outLimit = Math.min(allOut.length, outLimit + inSlack);
  }

  const inNeighbors = allIn.slice(0, inLimit);
  const outNeighbors = allOut.slice(0, outLimit);
  const truncated = inNeighbors.length < allIn.length || outNeighbors.length < allOut.length;

  return {
    found: true as const,
    nodeId,
    inNeighbors,
    outNeighbors,
    ...(truncated && { truncated: true }),
  };
}

export const getNeighborsToolDef = {
  name: 'get_neighbors',
  description:
    'Returns the immediate (1-hop) in and/or out neighbors of a node in the dependency graph. Groups multiple edges between the same pair of nodes. Truncates when the neighbor count exceeds the limit.',
  inputSchema: GetNeighborsInput,
  handler: getNeighborsHandler,
} as const;
