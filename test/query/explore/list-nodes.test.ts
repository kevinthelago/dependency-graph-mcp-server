import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/graph/composed-view.js', () => ({
  composedView: vi.fn(),
}));
vi.mock('../../../src/server/envelope.js', () => ({
  registerTool: vi.fn(),
}));

import { composedView } from '../../../src/graph/composed-view.js';
import { listNodesHandler } from '../../../src/server/tools/list-nodes.js';
import { buildFixtureGraph, buildEmptyGraph } from './fixtures.js';

const mockComposedView = vi.mocked(composedView);
const CTX = { worktreeId: 'wt-test' };

beforeEach(() => {
  mockComposedView.mockReset();
});

describe('list_nodes – no worktree', () => {
  it('returns no_worktree error', async () => {
    mockComposedView.mockReturnValue(null);
    const result = await listNodesHandler({ limit: 100 }, CTX);
    expect(result).toMatchObject({ error: 'no_worktree' });
  });
});

describe('list_nodes – empty graph', () => {
  it('returns empty nodes array', async () => {
    mockComposedView.mockReturnValue(buildEmptyGraph() as any);
    const result = await listNodesHandler({ limit: 100 }, CTX) as any;
    expect(result.nodes).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.truncated).toBeUndefined();
    expect(result.cursor).toBeUndefined();
  });
});

describe('list_nodes – fixture graph', () => {
  beforeEach(() => {
    mockComposedView.mockReturnValue(buildFixtureGraph() as any);
  });

  it('returns all 8 nodes when no filter applied', async () => {
    const result = await listNodesHandler({ limit: 100 }, CTX) as any;
    expect(result.total).toBe(8); // 5 files + 2 symbols + 1 external
    expect(result.nodes).toHaveLength(8);
  });

  it('results are sorted by node id (deterministic)', async () => {
    const result = await listNodesHandler({ limit: 100 }, CTX) as any;
    const ids: string[] = result.nodes.map((n: any) => n.id);
    expect(ids).toEqual([...ids].sort());
  });

  it('filters by kind=file returns 5 file nodes', async () => {
    const result = await listNodesHandler({ kind: 'file', limit: 100 }, CTX) as any;
    expect(result.total).toBe(5);
    expect(result.nodes.every((n: any) => n.kind === 'file')).toBe(true);
  });

  it('filters by kind=symbol returns 2 symbol nodes', async () => {
    const result = await listNodesHandler({ kind: 'symbol', limit: 100 }, CTX) as any;
    expect(result.total).toBe(2);
    expect(result.nodes.every((n: any) => n.kind === 'symbol')).toBe(true);
  });

  it('filters by kind=external returns 1 external node', async () => {
    const result = await listNodesHandler({ kind: 'external', limit: 100 }, CTX) as any;
    expect(result.total).toBe(1);
    expect(result.nodes[0].id).toBe('ext:ts:lodash');
  });

  it('filters by language=ts returns all 8 (all are ts)', async () => {
    const result = await listNodesHandler({ language: 'ts', limit: 100 }, CTX) as any;
    expect(result.total).toBe(8);
  });

  it('filters by pathPrefix=src/c includes file:src/c.ts', async () => {
    const result = await listNodesHandler({ pathPrefix: 'src/c', limit: 100 }, CTX) as any;
    const ids: string[] = result.nodes.map((n: any) => n.id);
    expect(ids).toContain('file:src/c.ts');
  });

  it('pathPrefix=src/a includes file:src/a.ts and sym:src/a.ts#funcA', async () => {
    const result = await listNodesHandler({ pathPrefix: 'src/a', limit: 100 }, CTX) as any;
    const ids: string[] = result.nodes.map((n: any) => n.id);
    expect(ids).toContain('file:src/a.ts');
    expect(ids).toContain('sym:src/a.ts#funcA');
    // External nodes are not matched by pathPrefix
    expect(ids).not.toContain('ext:ts:lodash');
  });

  it('pathPrefix filter excludes external nodes', async () => {
    const result = await listNodesHandler({ pathPrefix: 'src/', limit: 100 }, CTX) as any;
    expect(result.nodes.every((n: any) => n.kind !== 'external')).toBe(true);
  });
});

describe('list_nodes – cursor pagination', () => {
  beforeEach(() => {
    mockComposedView.mockReturnValue(buildFixtureGraph() as any);
  });

  it('paginates correctly: first page has cursor, second page has no cursor', async () => {
    const page1 = await listNodesHandler({ limit: 5 }, CTX) as any;
    expect(page1.nodes).toHaveLength(5);
    expect(page1.total).toBe(8);
    expect(page1.truncated).toBe(true);
    expect(page1.cursor).toBeDefined();

    const page2 = await listNodesHandler({ limit: 5, cursor: page1.cursor }, CTX) as any;
    expect(page2.nodes).toHaveLength(3);
    expect(page2.truncated).toBeUndefined();
    expect(page2.cursor).toBeUndefined();
  });

  it('all pages together contain every node exactly once', async () => {
    const all: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listNodesHandler({ limit: 3, cursor }, CTX) as any;
      all.push(...page.nodes.map((n: any) => n.id));
      cursor = page.cursor;
    } while (cursor);

    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
  });

  it('paginated results respect filter + ordering', async () => {
    const page1 = await listNodesHandler({ kind: 'file', limit: 3 }, CTX) as any;
    const page2 = await listNodesHandler({ kind: 'file', limit: 3, cursor: page1.cursor }, CTX) as any;
    const all = [...page1.nodes, ...page2.nodes];
    expect(all).toHaveLength(5);
    expect(all.every((n: any) => n.kind === 'file')).toBe(true);
    const ids = all.map((n: any) => n.id);
    expect(ids).toEqual([...ids].sort());
  });
});
