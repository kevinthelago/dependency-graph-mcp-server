import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/graph/composed-view.js', () => ({
  composedView: vi.fn(),
}));
vi.mock('../../../src/query/resolve.js', () => ({
  resolveTarget: vi.fn(),
}));
vi.mock('../../../src/server/envelope.js', () => ({
  registerTool: vi.fn(),
}));

import { composedView } from '../../../src/graph/composed-view.js';
import { resolveTarget } from '../../../src/query/resolve.js';
import { getNeighborsHandler } from '../../../src/server/tools/get-neighbors.js';
import { buildFixtureGraph } from './fixtures.js';

const mockComposedView = vi.mocked(composedView);
const mockResolveTarget = vi.mocked(resolveTarget);
const CTX = { worktreeId: 'wt-test' };

beforeEach(() => {
  mockComposedView.mockReset();
  mockResolveTarget.mockReset();
  mockComposedView.mockReturnValue(buildFixtureGraph() as any);
});

describe('get_neighbors – no worktree', () => {
  it('returns no_worktree error', async () => {
    mockComposedView.mockReturnValue(null);
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'both', includeLocations: false, limit: 50 },
      CTX
    );
    expect(result).toMatchObject({ error: 'no_worktree' });
  });
});

describe('get_neighbors – not found / ambiguous', () => {
  it('returns found=false when node does not exist', async () => {
    mockResolveTarget.mockReturnValue({ notFound: true });
    const result = await getNeighborsHandler(
      { target: { path: 'src/missing.ts' }, direction: 'both', includeLocations: false, limit: 50 },
      CTX
    );
    expect(result).toEqual({ found: false });
  });

  it('returns found=false with candidates on ambiguous symbol', async () => {
    mockResolveTarget.mockReturnValue({ candidates: ['sym:src/a.ts#foo', 'sym:src/b.ts#foo'] });
    const result = await getNeighborsHandler(
      { target: { path: 'src/a.ts', symbol: 'foo' }, direction: 'both', includeLocations: false, limit: 50 },
      CTX
    ) as any;
    expect(result.found).toBe(false);
    expect(result.candidates).toHaveLength(2);
  });
});

describe('get_neighbors – direction=out', () => {
  it('returns out-neighbors of file:src/a.ts (b.ts, c.ts, lodash)', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    expect(result.found).toBe(true);
    expect(result.inNeighbors).toHaveLength(0);
    const outIds = result.outNeighbors.map((n: any) => n.node.id).sort();
    expect(outIds).toEqual(['ext:ts:lodash', 'file:src/b.ts', 'file:src/c.ts']);
  });

  it('each neighbor entry contains at least one edge', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    for (const n of result.outNeighbors) {
      expect(n.edges.length).toBeGreaterThan(0);
      expect(n.edges[0].from).toBe('file:src/a.ts');
    }
  });
});

describe('get_neighbors – direction=in', () => {
  it('returns in-neighbors of file:src/c.ts (a.ts and b.ts)', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/c.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/c.ts' }, direction: 'in', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    expect(result.found).toBe(true);
    expect(result.outNeighbors).toHaveLength(0);
    const inIds = result.inNeighbors.map((n: any) => n.node.id).sort();
    expect(inIds).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });

  it('each in-neighbor edge points to the queried node', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/c.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/c.ts' }, direction: 'in', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    for (const n of result.inNeighbors) {
      for (const e of n.edges) {
        expect(e.to).toBe('file:src/c.ts');
      }
    }
  });
});

describe('get_neighbors – direction=both', () => {
  it('returns both in and out neighbors of file:src/b.ts', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/b.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/b.ts' }, direction: 'both', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    // b.ts is imported by a.ts (in) and imports c.ts (out)
    const inIds = result.inNeighbors.map((n: any) => n.node.id);
    const outIds = result.outNeighbors.map((n: any) => n.node.id);
    expect(inIds).toContain('file:src/a.ts');
    expect(outIds).toContain('file:src/c.ts');
  });

  it('leaf node (c.ts) has in-neighbors but no out-neighbors', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/c.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/c.ts' }, direction: 'both', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    expect(result.inNeighbors.length).toBeGreaterThan(0);
    expect(result.outNeighbors).toHaveLength(0);
  });
});

describe('get_neighbors – truncation', () => {
  it('sets truncated=true and caps results when limit is exceeded', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    // a.ts has 3 out-neighbors; limit=2 should truncate
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 2 },
      CTX
    ) as any;

    expect(result.truncated).toBe(true);
    expect(result.outNeighbors.length).toBeLessThanOrEqual(2);
  });

  it('does not set truncated when all neighbors fit within limit', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    expect(result.truncated).toBeUndefined();
  });
});

describe('get_neighbors – locations', () => {
  it('omits edge loc when includeLocations=false', async () => {
    const graph = buildFixtureGraph();
    // Add a loc to one edge
    const edges = graph.edges('file:src/a.ts', 'file:src/b.ts');
    if (edges.length > 0) {
      graph.setEdgeAttribute(edges[0], 'loc', { line: 2, col: 0 });
    }
    mockComposedView.mockReturnValue(graph as any);
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });

    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    const bEntry = result.outNeighbors.find((n: any) => n.node.id === 'file:src/b.ts');
    expect(bEntry.edges[0].loc).toBeUndefined();
  });

  it('includes edge loc when includeLocations=true', async () => {
    const graph = buildFixtureGraph();
    const edges = graph.edges('file:src/a.ts', 'file:src/b.ts');
    if (edges.length > 0) {
      graph.setEdgeAttribute(edges[0], 'loc', { line: 2, col: 0 });
    }
    mockComposedView.mockReturnValue(graph as any);
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });

    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: true, limit: 50 },
      CTX
    ) as any;

    const bEntry = result.outNeighbors.find((n: any) => n.node.id === 'file:src/b.ts');
    expect(bEntry.edges[0].loc).toEqual({ line: 2, col: 0 });
  });
});

describe('get_neighbors – ordering', () => {
  it('inNeighbors are sorted by node id', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/c.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/c.ts' }, direction: 'in', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    const ids = result.inNeighbors.map((n: any) => n.node.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('outNeighbors are sorted by node id', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    const result = await getNeighborsHandler(
      { target: { nodeId: 'file:src/a.ts' }, direction: 'out', includeLocations: false, limit: 50 },
      CTX
    ) as any;

    const ids = result.outNeighbors.map((n: any) => n.node.id);
    expect(ids).toEqual([...ids].sort());
  });
});
