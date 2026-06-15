import { describe, it, expect, beforeEach } from 'vitest';
import Graph from 'graphology';
import { _setTestView, _clearTestViews } from '../../../src/query/store.js';
import { handleTracePaths } from '../../../src/server/tools/trace-paths.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const WORKTREE = 'wt-test';
const ctx = { worktreeId: WORKTREE };

function makeGraph(): Graph {
  return new Graph({ type: 'directed', multi: true });
}

function node(g: Graph, id: string, kind: 'file' | 'symbol' | 'external' = 'file'): void {
  g.addNode(id, { id, kind, name: id, language: 'ts' });
}

function edge(
  g: Graph,
  from: string,
  to: string,
  kind: 'import' | 'reference' = 'import',
  targetType: 'file' | 'symbol' | 'external' = 'file',
): void {
  g.addDirectedEdge(from, to, { from, to, kind, targetType, resolution: 'resolved' });
}

function edgeWithLoc(
  g: Graph,
  from: string,
  to: string,
  line: number,
  col: number,
): void {
  g.addDirectedEdge(from, to, {
    from, to, kind: 'import', targetType: 'file', resolution: 'resolved',
    loc: { line, col },
  });
}

function setGraph(g: Graph): void {
  _setTestView(WORKTREE, g);
}

function nodeIds(result: Awaited<ReturnType<typeof handleTracePaths>>, pathIndex = 0): string[] {
  if ('paths' in result) return result.paths[pathIndex]?.nodes.map((n) => n.id) ?? [];
  return [];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('trace_paths', () => {
  beforeEach(() => _clearTestViews());

  // ── direct path ──────────────────────────────────────────────────────────────

  it('direct path: A → B (1 hop, forward)', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    edge(g, 'file:a', 'file:b');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({
      paths: [{ nodes: [{ id: 'file:a' }, { id: 'file:b' }] }],
    });
    expect('paths' in result && result.paths[0]?.edges).toMatchObject([
      { from: 'file:a', to: 'file:b', kind: 'import' },
    ]);
  });

  // ── multi-hop ────────────────────────────────────────────────────────────────

  it('multi-hop path: A → B → C', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c');
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:c' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(nodeIds(result)).toEqual(['file:a', 'file:b', 'file:c']);
  });

  // ── k-shortest ───────────────────────────────────────────────────────────────

  it('k-shortest: 2 paths via different routes', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c'); node(g, 'file:d');
    // Path 1: A→B→D  (2 hops)
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:d');
    // Path 2: A→C→D  (2 hops)
    edge(g, 'file:a', 'file:c');
    edge(g, 'file:c', 'file:d');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:d' }, direction: 'forward', k: 2, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths).toHaveLength(2);
    const ids = result.paths.map((p) => p.nodes.map((n) => n.id));
    expect(ids).toContainEqual(['file:a', 'file:b', 'file:d']);
    expect(ids).toContainEqual(['file:a', 'file:c', 'file:d']);
  });

  it('k-shortest returns shortest first, then longer', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c'); node(g, 'file:d');
    // Short path: A→D (1 hop)
    edge(g, 'file:a', 'file:d');
    // Long path: A→B→C→D (3 hops)
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    edge(g, 'file:c', 'file:d');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:d' }, direction: 'forward', k: 2, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths).toHaveLength(2);
    // Shortest (1 hop) must be first
    expect(result.paths[0]?.nodes).toHaveLength(2);
    expect(result.paths[1]?.nodes).toHaveLength(4);
  });

  // ── reverse direction ────────────────────────────────────────────────────────

  it('reverse direction: dependents path C ← B ← A', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c');
    // A→B→C means A depends on B which depends on C
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    setGraph(g);

    // Ask: starting from C, can we reach A following dependents (reverse edges)?
    const result = await handleTracePaths(
      { from: { nodeId: 'file:c' }, to: { nodeId: 'file:a' }, direction: 'reverse', k: 1, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths[0]?.nodes.map((n) => n.id)).toEqual(['file:c', 'file:b', 'file:a']);
  });

  it('reverse direction: no path from source node when it has no dependents', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    edge(g, 'file:a', 'file:b'); // A→B: A depends on B; B has no dependents
    setGraph(g);

    // A has no in-edges (nothing depends on A), so direction=reverse from A finds nothing
    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'reverse', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  // ── any direction ────────────────────────────────────────────────────────────

  it('any direction: finds path regardless of edge direction', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c');
    // A→B and C→B (B is a hub; C not reachable from A forward)
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:c', 'file:b');
    setGraph(g);

    // A cannot reach C via forward (A→B, C→B)
    const fwd = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:c' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );
    expect(fwd).toMatchObject({ found: false });

    // But any direction sees B as a connector
    const any = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:c' }, direction: 'any', k: 1, includeLocations: false },
      ctx,
    );
    expect('paths' in any).toBe(true);
    if (!('paths' in any)) return;
    expect(any.paths[0]?.nodes.map((n) => n.id)).toEqual(['file:a', 'file:b', 'file:c']);
  });

  // ── no path ──────────────────────────────────────────────────────────────────

  it('no path returns found: false', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    // No edges — A and B are disconnected
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  // ── self path ────────────────────────────────────────────────────────────────

  it('from === to returns trivial self path', async () => {
    const g = makeGraph();
    node(g, 'file:a');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:a' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ self: true, node: { id: 'file:a' } });
  });

  // ── cycle ────────────────────────────────────────────────────────────────────

  it('cycle: only simple paths returned (no node revisited)', async () => {
    const g = makeGraph();
    // A→B→C→A (cycle) plus B→D (exit)
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c'); node(g, 'file:d');
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    edge(g, 'file:c', 'file:a'); // cycle back
    edge(g, 'file:b', 'file:d'); // exit to D
    setGraph(g);

    // A→B→D should be found; A→B→C→A→B→D (revisits A,B) must NOT appear
    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:d' }, direction: 'forward', k: 3, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;

    for (const p of result.paths) {
      const ids = p.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length); // all ids unique (simple path)
    }
  });

  it('self-loop: A→A — only simple paths, so self-loop not traversed for A→B', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    edge(g, 'file:a', 'file:a'); // self-loop on A
    edge(g, 'file:a', 'file:b');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(nodeIds(result)).toEqual(['file:a', 'file:b']);
  });

  // ── maxDepth ─────────────────────────────────────────────────────────────────

  it('maxDepth caps path length: 3-hop path not returned when maxDepth=2', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c'); node(g, 'file:d');
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    edge(g, 'file:c', 'file:d');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:d' }, direction: 'forward', k: 1, maxDepth: 2, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  it('maxDepth allows path exactly at limit', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b'); node(g, 'file:c');
    edge(g, 'file:a', 'file:b');
    edge(g, 'file:b', 'file:c');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:c' }, direction: 'forward', k: 1, maxDepth: 2, includeLocations: false },
      ctx,
    );

    expect(nodeIds(result)).toEqual(['file:a', 'file:b', 'file:c']);
  });

  // ── includeLocations ─────────────────────────────────────────────────────────

  it('includeLocations attaches loc to edges when available', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    edgeWithLoc(g, 'file:a', 'file:b', 5, 10);
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: true },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths[0]?.edges[0]?.loc).toEqual({ line: 5, col: 10 });
  });

  it('includeLocations: false omits loc even when present', async () => {
    const g = makeGraph();
    node(g, 'file:a'); node(g, 'file:b');
    edgeWithLoc(g, 'file:a', 'file:b', 5, 10);
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths[0]?.edges[0]?.loc).toBeUndefined();
  });

  // ── unknown / ambiguous endpoints ─────────────────────────────────────────────

  it('unknown from node returns found: false', async () => {
    const g = makeGraph();
    node(g, 'file:b');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:unknown' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  it('unknown to node returns found: false', async () => {
    const g = makeGraph();
    node(g, 'file:a');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:unknown' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  it('ambiguous path+symbol returns candidates', async () => {
    const g = makeGraph();
    node(g, 'file:a.ts');
    // Two symbols named ambiguously
    node(g, 'sym:a.ts#foo~1', 'symbol');
    node(g, 'sym:a.ts#foo~2', 'symbol');
    node(g, 'file:b');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { path: 'a.ts', symbol: 'foo' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect('found' in result && 'candidates' in result).toBe(true);
  });

  // ── path-based target addressing ──────────────────────────────────────────────

  it('path-based addressing resolves file nodes', async () => {
    const g = makeGraph();
    node(g, 'file:src/a.ts');
    node(g, 'file:src/b.ts');
    edge(g, 'file:src/a.ts', 'file:src/b.ts');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { path: 'src/a.ts' }, to: { path: 'src/b.ts' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(nodeIds(result)).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });

  it('path+symbol addressing resolves symbol nodes', async () => {
    const g = makeGraph();
    node(g, 'file:a.ts');
    node(g, 'sym:a.ts#MyClass', 'symbol');
    node(g, 'file:b.ts');
    node(g, 'sym:b.ts#OtherClass', 'symbol');
    edge(g, 'sym:a.ts#MyClass', 'sym:b.ts#OtherClass', 'reference', 'symbol');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { path: 'a.ts', symbol: 'MyClass' }, to: { path: 'b.ts', symbol: 'OtherClass' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(nodeIds(result)).toEqual(['sym:a.ts#MyClass', 'sym:b.ts#OtherClass']);
  });

  // ── empty graph ───────────────────────────────────────────────────────────────

  it('empty graph returns found: false', async () => {
    setGraph(makeGraph());

    const result = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect(result).toMatchObject({ found: false });
  });

  // ── node kind + edge kind preserved ──────────────────────────────────────────

  it('preserves edge kind (reference) in result', async () => {
    const g = makeGraph();
    node(g, 'sym:a.ts#fn', 'symbol');
    node(g, 'sym:b.ts#Bar', 'symbol');
    edge(g, 'sym:a.ts#fn', 'sym:b.ts#Bar', 'reference', 'symbol');
    setGraph(g);

    const result = await handleTracePaths(
      { from: { nodeId: 'sym:a.ts#fn' }, to: { nodeId: 'sym:b.ts#Bar' }, direction: 'forward', k: 1, includeLocations: false },
      ctx,
    );

    expect('paths' in result).toBe(true);
    if (!('paths' in result)) return;
    expect(result.paths[0]?.edges[0]).toMatchObject({ kind: 'reference', targetType: 'symbol' });
  });

  // ── worktree isolation ────────────────────────────────────────────────────────

  it('result is worktree-scoped (different worktrees see different graphs)', async () => {
    const g1 = makeGraph();
    node(g1, 'file:a'); node(g1, 'file:b');
    edge(g1, 'file:a', 'file:b');
    _setTestView('wt-1', g1);

    const g2 = makeGraph(); // no edges
    node(g2, 'file:a'); node(g2, 'file:b');
    _setTestView('wt-2', g2);

    const r1 = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      { worktreeId: 'wt-1' },
    );
    const r2 = await handleTracePaths(
      { from: { nodeId: 'file:a' }, to: { nodeId: 'file:b' }, direction: 'forward', k: 1, includeLocations: false },
      { worktreeId: 'wt-2' },
    );

    expect('paths' in r1).toBe(true);
    expect(r2).toMatchObject({ found: false });
  });
});
