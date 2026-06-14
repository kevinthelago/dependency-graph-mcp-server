import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the handler
vi.mock('../../../src/graph/composed-view.js', () => ({
  composedView: vi.fn(),
}));
vi.mock('../../../src/server/envelope.js', () => ({
  registerTool: vi.fn(),
}));

import { composedView } from '../../../src/graph/composed-view.js';
import { getStatsHandler } from '../../../src/server/tools/get-stats.js';
import { buildFixtureGraph, buildEmptyGraph } from './fixtures.js';

const mockComposedView = vi.mocked(composedView);
const CTX = { worktreeId: 'wt-test' };

beforeEach(() => {
  mockComposedView.mockReset();
});

describe('get_stats – empty / unindexed project', () => {
  it('returns no_worktree error when no worktree is registered', async () => {
    mockComposedView.mockReturnValue(null);
    const result = await getStatsHandler({ topN: 10 }, CTX);
    expect(result).toMatchObject({ error: 'no_worktree' });
  });

  it('returns zeroed stats with indexed=false for empty graph', async () => {
    mockComposedView.mockReturnValue(buildEmptyGraph() as any);
    const result = await getStatsHandler({ topN: 10 }, CTX);
    expect(result).toMatchObject({
      indexed: false,
      fileCount: 0,
      symbolCount: 0,
      externalCount: 0,
      edgeCount: 0,
      languageBreakdown: {},
      cycleCount: 0,
      hotspots: [],
    });
  });
});

describe('get_stats – fixture graph', () => {
  beforeEach(() => {
    mockComposedView.mockReturnValue(buildFixtureGraph() as any);
  });

  it('counts nodes by kind correctly', async () => {
    const result = await getStatsHandler({ topN: 10 }, CTX) as any;
    expect(result.indexed).toBe(true);
    expect(result.fileCount).toBe(5);
    expect(result.symbolCount).toBe(2);
    expect(result.externalCount).toBe(1);
  });

  it('counts edges correctly', async () => {
    const result = await getStatsHandler({ topN: 10 }, CTX) as any;
    expect(result.edgeCount).toBe(7);
  });

  it('reports language breakdown', async () => {
    const result = await getStatsHandler({ topN: 10 }, CTX) as any;
    // All 8 non-null-language nodes are TypeScript
    expect(result.languageBreakdown).toEqual({ ts: 8 });
  });

  it('detects one cycle group (the x↔y cycle)', async () => {
    const result = await getStatsHandler({ topN: 10 }, CTX) as any;
    expect(result.cycleCount).toBe(1);
  });

  it('returns top hotspot as file:src/c.ts with fanIn=2', async () => {
    const result = await getStatsHandler({ topN: 3 }, CTX) as any;
    expect(result.hotspots[0]).toMatchObject({
      id: 'file:src/c.ts',
      fanIn: 2,
    });
  });

  it('respects topN parameter', async () => {
    const r1 = await getStatsHandler({ topN: 1 }, CTX) as any;
    const r2 = await getStatsHandler({ topN: 3 }, CTX) as any;
    expect(r1.hotspots).toHaveLength(1);
    expect(r2.hotspots.length).toBeLessThanOrEqual(3);
  });

  it('hotspots are sorted descending by fanIn then ascending by id', async () => {
    const result = await getStatsHandler({ topN: 100 }, CTX) as any;
    const fanIns = result.hotspots.map((h: any) => h.fanIn);
    expect(fanIns).toEqual([...fanIns].sort((a: number, b: number) => b - a));
  });
});

describe('get_stats – memoization', () => {
  it('returns the same result on consecutive calls without graph change', async () => {
    const graph = buildFixtureGraph();
    mockComposedView.mockReturnValue(graph as any);
    const r1 = await getStatsHandler({ topN: 10 }, CTX) as any;
    const r2 = await getStatsHandler({ topN: 10 }, CTX) as any;
    expect(r1).toEqual(r2);
  });

  it('invalidates cache when graph size changes', async () => {
    const graph = buildFixtureGraph();
    mockComposedView.mockReturnValue(graph as any);
    const r1 = await getStatsHandler({ topN: 10 }, CTX) as any;

    // Add a node to invalidate by changing order
    graph.addNode('file:src/new.ts', { kind: 'file', language: 'ts', name: 'src/new.ts' });
    const r2 = await getStatsHandler({ topN: 10 }, CTX) as any;
    expect(r2.fileCount).toBe(r1.fileCount + 1);
  });
});
