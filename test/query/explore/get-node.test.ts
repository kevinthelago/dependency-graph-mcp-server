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
import { getNodeHandler } from '../../../src/server/tools/get-node.js';
import { buildFixtureGraph } from './fixtures.js';

const mockComposedView = vi.mocked(composedView);
const mockResolveTarget = vi.mocked(resolveTarget);
const CTX = { worktreeId: 'wt-test' };

beforeEach(() => {
  mockComposedView.mockReset();
  mockResolveTarget.mockReset();
});

describe('get_node – no worktree', () => {
  it('returns no_worktree error', async () => {
    mockComposedView.mockReturnValue(null);
    const result = await getNodeHandler(
      { target: { nodeId: 'file:src/a.ts' }, includeLocations: false },
      CTX
    );
    expect(result).toMatchObject({ error: 'no_worktree' });
  });
});

describe('get_node – not found / ambiguous', () => {
  beforeEach(() => {
    mockComposedView.mockReturnValue(buildFixtureGraph() as any);
  });

  it('returns found=false when resolveTarget returns notFound', async () => {
    mockResolveTarget.mockReturnValue({ notFound: true });
    const result = await getNodeHandler(
      { target: { path: 'src/does-not-exist.ts' }, includeLocations: false },
      CTX
    );
    expect(result).toEqual({ found: false });
  });

  it('returns found=false with candidates when resolveTarget returns candidates', async () => {
    mockResolveTarget.mockReturnValue({
      candidates: ['sym:src/a.ts#funcA', 'sym:src/b.ts#funcA'],
    });
    const result = await getNodeHandler(
      { target: { path: 'src/a.ts', symbol: 'funcA' }, includeLocations: false },
      CTX
    ) as any;
    expect(result.found).toBe(false);
    expect(result.candidates).toEqual(['sym:src/a.ts#funcA', 'sym:src/b.ts#funcA']);
  });
});

describe('get_node – found', () => {
  beforeEach(() => {
    mockComposedView.mockReturnValue(buildFixtureGraph() as any);
  });

  it('returns file node with correct kind and degree', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/c.ts' });
    const result = await getNodeHandler(
      { target: { nodeId: 'file:src/c.ts' }, includeLocations: false },
      CTX
    ) as any;

    expect(result.found).toBe(true);
    expect(result.node.id).toBe('file:src/c.ts');
    expect(result.node.kind).toBe('file');
    expect(result.node.language).toBe('ts');
    expect(result.node.name).toBe('src/c.ts');
    // c.ts is imported by a.ts and b.ts → inDegree = 2
    expect(result.inDegree).toBe(2);
    // c.ts has no outgoing edges → outDegree = 0
    expect(result.outDegree).toBe(0);
  });

  it('returns symbol node with file and symbolKind', async () => {
    mockResolveTarget.mockReturnValue({ id: 'sym:src/a.ts#funcA' });
    const result = await getNodeHandler(
      { target: { path: 'src/a.ts', symbol: 'funcA' }, includeLocations: false },
      CTX
    ) as any;

    expect(result.found).toBe(true);
    expect(result.node.kind).toBe('symbol');
    expect(result.node.name).toBe('funcA');
    expect(result.node.symbolKind).toBe('function');
    expect(result.node.file).toBe('src/a.ts');
    expect(result.node.exported).toBe(true);
  });

  it('omits loc when includeLocations=false even if node has loc', async () => {
    const graph = buildFixtureGraph();
    graph.setNodeAttribute('file:src/a.ts', 'loc', { line: 1, col: 0 });
    mockComposedView.mockReturnValue(graph as any);
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });

    const result = await getNodeHandler(
      { target: { nodeId: 'file:src/a.ts' }, includeLocations: false },
      CTX
    ) as any;
    expect(result.node.loc).toBeUndefined();
  });

  it('includes loc when includeLocations=true and node has loc', async () => {
    const graph = buildFixtureGraph();
    graph.setNodeAttribute('sym:src/a.ts#funcA', 'loc', { line: 5, col: 0 });
    mockComposedView.mockReturnValue(graph as any);
    mockResolveTarget.mockReturnValue({ id: 'sym:src/a.ts#funcA' });

    const result = await getNodeHandler(
      { target: { path: 'src/a.ts', symbol: 'funcA' }, includeLocations: true },
      CTX
    ) as any;
    expect(result.node.loc).toEqual({ line: 5, col: 0 });
  });

  it('returns external node with no file or symbolKind', async () => {
    mockResolveTarget.mockReturnValue({ id: 'ext:ts:lodash' });
    const result = await getNodeHandler(
      { target: { nodeId: 'ext:ts:lodash' }, includeLocations: false },
      CTX
    ) as any;

    expect(result.found).toBe(true);
    expect(result.node.kind).toBe('external');
    expect(result.node.name).toBe('lodash');
    expect(result.node.file).toBeUndefined();
    expect(result.node.symbolKind).toBeUndefined();
  });

  it('returns correct degree for a.ts (2 out file imports + 1 external import, 0 in)', async () => {
    mockResolveTarget.mockReturnValue({ id: 'file:src/a.ts' });
    const result = await getNodeHandler(
      { target: { nodeId: 'file:src/a.ts' }, includeLocations: false },
      CTX
    ) as any;

    expect(result.inDegree).toBe(0);
    expect(result.outDegree).toBe(3); // b.ts, c.ts, lodash
  });
});
