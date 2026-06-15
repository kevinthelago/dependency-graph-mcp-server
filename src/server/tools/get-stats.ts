import { z } from 'zod';
import { composedView } from '../../graph/composed-view.js';

// Structural type for the graphology graph view returned by composedView.
// Will be replaced by the actual import from ../../graph/composed-view.js once core lands.
interface GraphView {
  order: number;
  size: number;
  forEachNode(cb: (id: string, attrs: Record<string, unknown>) => void): void;
  forEachOutEdge(
    node: string,
    cb: (edge: string, attrs: Record<string, unknown>, source: string, target: string) => void
  ): void;
  inDegree(id: string): number;
  hasNode(id: string): boolean;
}

export interface HotspotEntry {
  id: string;
  name: string;
  language: string | null;
  fanIn: number;
}

export interface StatsResult {
  indexed: boolean;
  fileCount: number;
  symbolCount: number;
  externalCount: number;
  edgeCount: number;
  languageBreakdown: Record<string, number>;
  cycleCount: number;
  hotspots: HotspotEntry[];
}

interface ToolContext {
  worktreeId: string;
}

const MAX_CACHED_HOTSPOTS = 100;

const GetStatsInput = z.object({
  topN: z
    .number()
    .int()
    .min(1)
    .max(MAX_CACHED_HOTSPOTS)
    .default(10)
    .describe('Number of high fan-in hotspot nodes to return (1–100)'),
});

// Memoize per worktreeId; invalidated when view.order or view.size changes.
// Note: order+size is a proxy for graph mutations. If the store exposes a revision
// counter in a later iteration, prefer that over this heuristic.
const cache = new Map<
  string,
  { order: number; size: number; snapshot: StatsResult }
>();

export async function getStatsHandler(
  input: z.infer<typeof GetStatsInput>,
  ctx: ToolContext
): Promise<{ error: 'no_worktree'; message: string } | (StatsResult & { hotspots: HotspotEntry[] })> {
  const view = composedView(ctx.worktreeId) as GraphView | null;
  if (!view) {
    return { error: 'no_worktree', message: 'No worktree registered for this session.' };
  }

  const hit = cache.get(ctx.worktreeId);
  if (hit && hit.order === view.order && hit.size === view.size) {
    return { ...hit.snapshot, hotspots: hit.snapshot.hotspots.slice(0, input.topN) };
  }

  const snapshot = computeSnapshot(view);
  cache.set(ctx.worktreeId, { order: view.order, size: view.size, snapshot });
  return { ...snapshot, hotspots: snapshot.hotspots.slice(0, input.topN) };
}

function computeSnapshot(view: GraphView): StatsResult {
  if (view.order === 0) {
    return {
      indexed: false,
      fileCount: 0,
      symbolCount: 0,
      externalCount: 0,
      edgeCount: 0,
      languageBreakdown: {},
      cycleCount: 0,
      hotspots: [],
    };
  }

  let fileCount = 0;
  let symbolCount = 0;
  let externalCount = 0;
  const langCounts: Record<string, number> = {};
  const candidates: HotspotEntry[] = [];

  view.forEachNode((id, attrs) => {
    const kind = attrs.kind as string;
    if (kind === 'file') fileCount++;
    else if (kind === 'symbol') symbolCount++;
    else if (kind === 'external') externalCount++;

    const lang = attrs.language as string | null;
    if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1;

    const fanIn = view.inDegree(id);
    if (fanIn > 0) {
      candidates.push({ id, name: attrs.name as string, language: lang, fanIn });
    }
  });

  // Deterministic: descending fanIn, then ascending id as tiebreaker
  candidates.sort((a, b) => b.fanIn - a.fanIn || a.id.localeCompare(b.id));

  return {
    indexed: true,
    fileCount,
    symbolCount,
    externalCount,
    edgeCount: view.size,
    languageBreakdown: langCounts,
    cycleCount: countFileSCCs(view),
    hotspots: candidates.slice(0, MAX_CACHED_HOTSPOTS),
  };
}

/**
 * Count strongly connected components of size > 1 among file nodes,
 * following only file→file import edges. Uses Tarjan's algorithm.
 * cycleCount = number of cyclic dependency groups.
 */
function countFileSCCs(view: GraphView): number {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  let timer = 0;
  let count = 0;

  const visit = (v: string): void => {
    disc.set(v, timer);
    low.set(v, timer);
    timer++;
    stack.push(v);
    onStack.add(v);

    view.forEachOutEdge(v, (_e, attrs, _src, target) => {
      if ((attrs.kind as string) !== 'import') return;
      if (!view.hasNode(target)) return;
      // Only traverse file→file edges
      if (!disc.has(target)) {
        visit(target);
        low.set(v, Math.min(low.get(v)!, low.get(target)!));
      } else if (onStack.has(target)) {
        low.set(v, Math.min(low.get(v)!, disc.get(target)!));
      }
    });

    if (low.get(v) === disc.get(v)) {
      const component: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.push(w);
      } while (w !== v);
      if (component.length > 1) count++;
    }
  };

  view.forEachNode((id, attrs) => {
    if ((attrs.kind as string) === 'file' && !disc.has(id)) {
      visit(id);
    }
  });

  return count;
}

export const statsToolDef = {
  name: 'get_stats',
  description:
    'Returns aggregate statistics for the current worktree dependency graph: node/edge counts, per-language breakdown, cycle count (SCCs of size > 1 among file nodes), and top fan-in hotspots.',
  inputSchema: GetStatsInput,
  handler: getStatsHandler,
} as const;
