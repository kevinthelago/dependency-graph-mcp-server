import { z } from 'zod';
import { composedView } from '../../graph/composed-view.js';
import { resolveTarget } from '../../query/resolve.js';

interface GraphView {
  getNodeAttributes(id: string): Record<string, unknown>;
  hasNode(id: string): boolean;
  inDegree(id: string): number;
  outDegree(id: string): number;
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

interface ToolContext {
  worktreeId: string;
}

const TargetSchema = z.union([
  z.object({ nodeId: z.string() }),
  z.object({ path: z.string() }),
  z.object({ path: z.string(), symbol: z.string() }),
]);

const GetNodeInput = z.object({
  target: TargetSchema.describe('Node to look up: by stable nodeId, file path, or path + symbol name'),
  includeLocations: z
    .boolean()
    .default(false)
    .describe('Include source location (line/col) on the node when available'),
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
    node.loc = attrs.loc as { line: number; col: number };
  }
  if (attrs.exported !== undefined) node.exported = attrs.exported as boolean;
  return node;
}

export async function getNodeHandler(
  input: z.infer<typeof GetNodeInput>,
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

  const { id } = resolved;
  const attrs = view.getNodeAttributes(id);

  return {
    found: true as const,
    node: serializeNode(id, attrs, input.includeLocations),
    inDegree: view.inDegree(id),
    outDegree: view.outDegree(id),
  };
}

export const getNodeToolDef = {
  name: 'get_node',
  description:
    'Returns details and degree information for a single node in the dependency graph. Accepts a stable node id, a file path, or a file path + symbol name. Returns not-found when the target does not exist, or candidates when a path+symbol is ambiguous.',
  inputSchema: GetNodeInput,
  handler: getNodeHandler,
} as const;
