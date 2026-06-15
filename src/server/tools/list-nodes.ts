import { z } from 'zod';
import { composedView } from '../../graph/composed-view.js';

interface GraphView {
  order: number;
  forEachNode(cb: (id: string, attrs: Record<string, unknown>) => void): void;
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

const LANGUAGE_VALUES = ['ts', 'js', 'python', 'rust', 'c', 'cpp', 'objc'] as const;
const KIND_VALUES = ['file', 'symbol', 'external'] as const;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

const ListNodesInput = z.object({
  pathPrefix: z.string().optional().describe('Filter nodes by file path prefix (repo-relative)'),
  language: z.enum(LANGUAGE_VALUES).optional().describe('Filter by language'),
  kind: z.enum(KIND_VALUES).optional().describe('Filter by node kind'),
  cursor: z.string().optional().describe('Opaque pagination cursor from a previous response'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('Max nodes to return per page (1–500)'),
});

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset)).toString('base64url');
}

function decodeCursor(cursor: string): number {
  const n = parseInt(Buffer.from(cursor, 'base64url').toString('utf8'), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function matchesPathPrefix(attrs: Record<string, unknown>, prefix: string): boolean {
  const kind = attrs.kind as string;
  if (kind === 'file') return (attrs.name as string).startsWith(prefix);
  if (kind === 'symbol') return ((attrs.file as string | undefined) ?? '').startsWith(prefix);
  // external nodes have module specifiers, not repo-relative paths — exclude
  return false;
}

function serializeNode(id: string, attrs: Record<string, unknown>): SerializedNode {
  const node: SerializedNode = {
    id,
    kind: attrs.kind as SerializedNode['kind'],
    language: (attrs.language as string | null) ?? null,
    name: attrs.name as string,
  };
  if (attrs.symbolKind !== undefined) node.symbolKind = attrs.symbolKind as string;
  if (attrs.file !== undefined) node.file = attrs.file as string;
  if (attrs.loc !== undefined) node.loc = attrs.loc as NonNullable<SerializedNode['loc']>;
  if (attrs.exported !== undefined) node.exported = attrs.exported as boolean;
  return node;
}

export async function listNodesHandler(
  input: z.infer<typeof ListNodesInput>,
  ctx: ToolContext
) {
  const view = composedView(ctx.worktreeId) as GraphView | null;
  if (!view) {
    return { error: 'no_worktree' as const, message: 'No worktree registered for this session.' };
  }

  // Collect and filter
  const matched: Array<{ id: string; attrs: Record<string, unknown> }> = [];

  view.forEachNode((id, attrs) => {
    if (input.kind && attrs.kind !== input.kind) return;
    if (input.language && attrs.language !== input.language) return;
    if (input.pathPrefix && !matchesPathPrefix(attrs, input.pathPrefix)) return;
    matched.push({ id, attrs });
  });

  // Deterministic sort by node id
  matched.sort((a, b) => a.id.localeCompare(b.id));

  const total = matched.length;
  const offset = input.cursor ? decodeCursor(input.cursor) : 0;
  const page = matched.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  const hasMore = nextOffset < total;

  const result: {
    nodes: SerializedNode[];
    total: number;
    truncated?: boolean;
    cursor?: string;
  } = {
    nodes: page.map(({ id, attrs }) => serializeNode(id, attrs)),
    total,
  };

  if (hasMore) {
    result.truncated = true;
    result.cursor = encodeCursor(nextOffset);
  }

  return result;
}

export const listNodesToolDef = {
  name: 'list_nodes',
  description:
    'Lists nodes in the dependency graph with optional filtering by path prefix, language, and node kind. Supports cursor-based pagination. Results are deterministically ordered by node id.',
  inputSchema: ListNodesInput,
  handler: listNodesHandler,
} as const;
