/**
 * Tests for incremental delta application (lg-2, lg-4), re-resolution (lg-3),
 * and invalidation wiring (lg-5).
 *
 * Uses in-memory helpers: MemoryOverlay, MemoryCache, makeStubAnalyzer so the
 * tests run without any real git repo or network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { processIncrementalBatch, analyzeAndApply } from '../../src/orchestrator/incremental.js';
import { reresolveOneDegree } from '../../src/orchestrator/reresolve.js';
import { InvalidationEmitter } from '../../src/orchestrator/invalidation.js';
import { isBulkBatch } from '../../src/watcher/bulk.js';
import type { ChangeBatch } from '../../src/watcher/types.js';
import type { Overlay, OverlaySlice, GraphView } from '../../src/graph/store.js';
import type { Node, Edge, NodeAttrs } from '../../src/graph/model.js';
import type { LanguageAnalyzer, AnalysisFragment, ProjectContext } from '../../src/analyzers/types.js';
import type { CacheKey } from '../../src/cache/index.js';
import type { CacheAccess } from '../../src/orchestrator/incremental.js';

// ── In-memory helpers ────────────────────────────────────────────────────────

class MemoryOverlay implements Overlay {
  private readonly applied = new Map<string, OverlaySlice>();
  private readonly deleted = new Set<string>();

  applyFile(filePath: string, slice: OverlaySlice): void {
    this.deleted.delete(filePath);
    this.applied.set(filePath, slice);
  }

  deleteFile(filePath: string): void {
    this.applied.delete(filePath);
    this.deleted.add(filePath);
  }

  clearFile(filePath: string): void {
    this.applied.delete(filePath);
    this.deleted.delete(filePath);
  }

  isEmpty(): boolean {
    return this.applied.size === 0 && this.deleted.size === 0;
  }

  coveredFiles(): ReadonlySet<string> {
    return new Set([...this.applied.keys(), ...this.deleted]);
  }

  getSlice(filePath: string): OverlaySlice | undefined {
    return this.applied.get(filePath);
  }

  isDeleted(filePath: string): boolean {
    return this.deleted.has(filePath);
  }

  appliedCount(): number {
    return this.applied.size;
  }
}

function serializeKey(k: CacheKey): string {
  return `${k.analyzerId}:${k.analyzerVersion}:${k.grammarVersion}:${k.contentHash}`;
}

class MemoryCache implements CacheAccess {
  private readonly store = new Map<string, AnalysisFragment>();
  hits = 0;

  get(key: CacheKey): AnalysisFragment | undefined {
    const v = this.store.get(serializeKey(key));
    if (v !== undefined) this.hits++;
    return v;
  }

  put(key: CacheKey, fragment: AnalysisFragment): void {
    this.store.set(serializeKey(key), fragment);
  }
}

function fileNode(relPath: string): Node {
  return { id: `file:${relPath}`, kind: 'file', language: 'ts', name: relPath };
}

function symbolNode(relPath: string, sym: string): Node {
  return {
    id: `sym:${relPath}#${sym}`,
    kind: 'symbol',
    language: 'ts',
    name: sym,
    file: relPath,
  };
}

function importEdge(fromId: string, toId: string): Edge {
  return { from: fromId, to: toId, kind: 'import', targetType: 'file', resolution: 'resolved' };
}

function makeFragment(
  relPath: string,
  importedPaths: string[] = [],
  symbols: string[] = [],
): AnalysisFragment {
  const file = fileNode(relPath);
  const syms = symbols.map((s) => symbolNode(relPath, s));
  const edges = importedPaths.map((p) => importEdge(file.id, `file:${p}`));
  return { file, symbols: syms, edges, imports: [] };
}

function makeStubAnalyzer(fragmentFor: (path: string) => AnalysisFragment): LanguageAnalyzer {
  return {
    id: 'stub',
    extensions: ['.ts'],
    version: '0.0.1',
    async init(): Promise<void> {},
    async analyzeFile(path: string): Promise<AnalysisFragment> {
      return fragmentFor(path);
    },
    async dispose(): Promise<void> {},
  };
}

const testProjectContext: ProjectContext = {
  repoRoot: '/tmp/test-repo',
  config: {},
  resolveExternal: () => null,
};

/** A minimal read-only graph view for reresolve tests. */
class StubGraphView implements GraphView {
  private readonly nodeMap = new Map<string, NodeAttrs>();
  private readonly inEdges = new Map<string, string[]>();

  addNode(id: string, attrs: NodeAttrs): void {
    this.nodeMap.set(id, attrs);
  }

  addInEdge(from: string, to: string): void {
    const existing = this.inEdges.get(to) ?? [];
    existing.push(from);
    this.inEdges.set(to, existing);
  }

  hasNode(id: string): boolean {
    return this.nodeMap.has(id);
  }

  outNeighbors(_id: string): string[] {
    return [];
  }

  inNeighbors(id: string): string[] {
    return this.inEdges.get(id) ?? [];
  }

  neighbors(id: string): string[] {
    return [...this.inNeighbors(id)];
  }

  getNodeAttributes(id: string): NodeAttrs {
    const a = this.nodeMap.get(id);
    if (a === undefined) throw new Error(`Node not found: ${id}`);
    return a as NodeAttrs;
  }

  nodes(): string[] {
    return [...this.nodeMap.keys()];
  }

  get order(): number {
    return this.nodeMap.size;
  }

  get size(): number {
    return [...this.inEdges.values()].reduce((s, v) => s + v.length, 0);
  }
}

// ── analyzeAndApply ──────────────────────────────────────────────────────────

describe('analyzeAndApply', () => {
  it('applies a file slice to the overlay and returns node IDs', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aa-test-'));
    try {
      const absPath = path.join(tmpDir, 'src/a.ts');
      await fs.mkdir(path.dirname(absPath), { recursive: true });
      await fs.writeFile(absPath, 'export const x = 1;');

      const overlay = new MemoryOverlay();
      const cache = new MemoryCache();
      const analyzer = makeStubAnalyzer((relPath) => makeFragment(relPath, [], ['x']));

      const ids = await analyzeAndApply(absPath, 'src/a.ts', overlay, analyzer, cache, testProjectContext);

      expect(ids).toContain('file:src/a.ts');
      expect(ids).toContain('sym:src/a.ts#x');
      expect(overlay.getSlice('src/a.ts')).toBeTruthy();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('deletes the file from the overlay when the file is unreadable', async () => {
    const overlay = new MemoryOverlay();
    overlay.applyFile('src/gone.ts', { file: fileNode('src/gone.ts'), symbols: [], edges: [] });

    const cache = new MemoryCache();
    const analyzer = makeStubAnalyzer((p) => makeFragment(p));

    const ids = await analyzeAndApply(
      '/nonexistent/path/src/gone.ts',
      'src/gone.ts',
      overlay,
      analyzer,
      cache,
      testProjectContext,
    );

    expect(ids).toHaveLength(0);
    expect(overlay.isDeleted('src/gone.ts')).toBe(true);
    expect(overlay.getSlice('src/gone.ts')).toBeUndefined();
  });

  it('uses the cache on second call with identical content', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aa-cache-test-'));
    try {
      const absPath = path.join(tmpDir, 'a.ts');
      await fs.writeFile(absPath, 'same content');

      const overlay = new MemoryOverlay();
      const cache = new MemoryCache();
      const spy = vi.fn((p: string) => makeFragment(p));
      const analyzer: LanguageAnalyzer = {
        id: 'stub', extensions: ['.ts'], version: '1',
        async init() {}, async dispose() {},
        async analyzeFile(p) { return spy(p); },
      };

      await analyzeAndApply(absPath, 'a.ts', overlay, analyzer, cache, testProjectContext);
      await analyzeAndApply(absPath, 'a.ts', overlay, analyzer, cache, testProjectContext);

      // Analyzer should only be called once; second call hits the cache
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── processIncrementalBatch ──────────────────────────────────────────────────

describe('processIncrementalBatch', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'incr-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function makeCtx(overlay: MemoryOverlay, getAnalyzer?: (absPath: string) => LanguageAnalyzer | undefined) {
    return {
      worktreeRoot: tmpDir,
      repoRoot: tmpDir,
      baseBranch: 'develop',
      overlay,
      getAnalyzer: getAnalyzer ?? (() => makeStubAnalyzer((p) => makeFragment(p))),
      cache: new MemoryCache(),
      projectContext: testProjectContext,
    };
  }

  it('applies an add event to the overlay', async () => {
    const absPath = path.join(tmpDir, 'src/new.ts');
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, 'export const n = 1;');

    const overlay = new MemoryOverlay();
    const batch: ChangeBatch = [{ type: 'add', path: absPath }];

    const result = await processIncrementalBatch(batch, makeCtx(overlay));

    expect(result.wasBulk).toBe(false);
    expect(overlay.getSlice('src/new.ts')).toBeTruthy();
    expect(result.changedNodeIds).toContain('file:src/new.ts');
  });

  it('applies a change event and replaces the old slice (stale-edge removal)', async () => {
    const absPath = path.join(tmpDir, 'src/a.ts');
    await fs.mkdir(path.dirname(absPath), { recursive: true });

    const overlay = new MemoryOverlay();
    // Seed an old slice: a.ts imports b.ts and c.ts
    overlay.applyFile('src/a.ts', {
      file: fileNode('src/a.ts'),
      symbols: [],
      edges: [importEdge('file:src/a.ts', 'file:src/b.ts'), importEdge('file:src/a.ts', 'file:src/c.ts')],
    });

    // Now write a new version that only imports c.ts
    await fs.writeFile(absPath, 'import "./c";');
    const newFragment = makeFragment('src/a.ts', ['src/c.ts']);
    const analyzer = makeStubAnalyzer(() => newFragment);

    const batch: ChangeBatch = [{ type: 'change', path: absPath }];
    await processIncrementalBatch(batch, makeCtx(overlay, () => analyzer));

    const slice = overlay.getSlice('src/a.ts');
    expect(slice).toBeTruthy();
    // New slice has only one edge (to c.ts)
    expect(slice!.edges.length).toBe(1);
    expect(slice!.edges[0]!.to).toBe('file:src/c.ts');
    // Stale edge to b.ts is gone
    expect(slice!.edges.every((e) => e.to !== 'file:src/b.ts')).toBe(true);
  });

  it('marks an unlinked file as deleted in the overlay', async () => {
    const overlay = new MemoryOverlay();
    const absPath = path.join(tmpDir, 'src/gone.ts');
    const batch: ChangeBatch = [{ type: 'unlink', path: absPath }];

    await processIncrementalBatch(batch, makeCtx(overlay));

    expect(overlay.isDeleted('src/gone.ts')).toBe(true);
  });

  it('handles a move: removes old path, applies new path', async () => {
    const newAbsPath = path.join(tmpDir, 'src/renamed.ts');
    await fs.mkdir(path.dirname(newAbsPath), { recursive: true });
    await fs.writeFile(newAbsPath, 'export {}');

    const overlay = new MemoryOverlay();
    overlay.applyFile('src/original.ts', { file: fileNode('src/original.ts'), symbols: [], edges: [] });

    const oldAbsPath = path.join(tmpDir, 'src/original.ts');
    const batch: ChangeBatch = [{ type: 'move', path: newAbsPath, oldPath: oldAbsPath }];
    await processIncrementalBatch(batch, makeCtx(overlay));

    expect(overlay.isDeleted('src/original.ts')).toBe(true);
    expect(overlay.getSlice('src/renamed.ts')).toBeTruthy();
  });

  it('skips files with no registered analyzer', async () => {
    const absPath = path.join(tmpDir, 'README.md');
    await fs.writeFile(absPath, '# hi');

    const overlay = new MemoryOverlay();
    const batch: ChangeBatch = [{ type: 'add', path: absPath }];
    const result = await processIncrementalBatch(batch, makeCtx(overlay, () => undefined));

    expect(overlay.appliedCount()).toBe(0);
    expect(result.changedNodeIds).toHaveLength(0);
  });

  it('detects a bulk batch and calls doBulkResync instead of per-file processing', async () => {
    const batch: ChangeBatch = Array.from({ length: 50 }, (_, i) => ({
      type: 'change' as const,
      path: path.join(tmpDir, `src/file${i}.ts`),
    }));

    expect(isBulkBatch(batch)).toBe(true);

    const overlay = new MemoryOverlay();
    const bulkResync = vi.fn(async () => {
      // Simulate bulk resync: apply a single summary slice
      overlay.applyFile('src/bulk-sentinel.ts', {
        file: fileNode('src/bulk-sentinel.ts'),
        symbols: [],
        edges: [],
      });
    });

    const ctx = { ...makeCtx(overlay), doBulkResync: bulkResync };
    const result = await processIncrementalBatch(batch, ctx);

    expect(result.wasBulk).toBe(true);
    expect(result.changedNodeIds).toHaveLength(0);
    expect(bulkResync).toHaveBeenCalledOnce();
    // The bulk sentinel was applied by the mock
    expect(overlay.getSlice('src/bulk-sentinel.ts')).toBeTruthy();
  });
});

// ── reresolveOneDegree ───────────────────────────────────────────────────────

describe('reresolveOneDegree', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'reresolve-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty when no changed nodes', async () => {
    const view = new StubGraphView();
    const overlay = new MemoryOverlay();
    const result = await reresolveOneDegree([], view, {
      worktreeRoot: tmpDir,
      overlay,
      getAnalyzer: () => undefined,
      cache: new MemoryCache(),
      projectContext: testProjectContext,
    });
    expect(result).toHaveLength(0);
  });

  it('re-analyzes 1-hop in-neighbor file nodes', async () => {
    // Graph: file:src/a.ts → imports → file:src/b.ts
    // b.ts changes → reresolve should re-analyze a.ts
    const view = new StubGraphView();
    view.addNode('file:src/b.ts', { kind: 'file', filePath: 'src/b.ts', displayName: 'src/b.ts' });
    view.addNode('file:src/a.ts', { kind: 'file', filePath: 'src/a.ts', displayName: 'src/a.ts' });
    view.addInEdge('file:src/a.ts', 'file:src/b.ts'); // a.ts imports b.ts

    // Create the file on disk so analyzeAndApply can read it
    const aAbs = path.join(tmpDir, 'src/a.ts');
    await fs.mkdir(path.dirname(aAbs), { recursive: true });
    await fs.writeFile(aAbs, 'import "./b";');

    const overlay = new MemoryOverlay();
    const reresolvedFragment = makeFragment('src/a.ts', ['src/b.ts']);
    const analyzer = makeStubAnalyzer(() => reresolvedFragment);

    const result = await reresolveOneDegree(['file:src/b.ts'], view, {
      worktreeRoot: tmpDir,
      overlay,
      getAnalyzer: () => analyzer,
      cache: new MemoryCache(),
      projectContext: testProjectContext,
    });

    expect(result).toContain('file:src/a.ts');
    expect(overlay.getSlice('src/a.ts')).toBeTruthy();
  });

  it('skips symbol and external in-neighbors (only re-analyzes file nodes)', async () => {
    const view = new StubGraphView();
    view.addNode('file:src/b.ts', { kind: 'file', filePath: 'src/b.ts', displayName: 'src/b.ts' });
    view.addNode('sym:src/x.ts#fn', { kind: 'symbol', filePath: 'src/x.ts', symbolName: 'fn', displayName: 'fn' });
    view.addInEdge('sym:src/x.ts#fn', 'file:src/b.ts');

    const overlay = new MemoryOverlay();
    const result = await reresolveOneDegree(['file:src/b.ts'], view, {
      worktreeRoot: tmpDir,
      overlay,
      getAnalyzer: () => makeStubAnalyzer((p) => makeFragment(p)),
      cache: new MemoryCache(),
      projectContext: testProjectContext,
    });

    // The symbol node is not a 'file' kind — no re-analysis
    expect(overlay.appliedCount()).toBe(0);
    expect(result).toHaveLength(0);
  });
});

// ── InvalidationEmitter ──────────────────────────────────────────────────────

describe('InvalidationEmitter', () => {
  it('calls the listener with node IDs', () => {
    const emitter = new InvalidationEmitter();
    const received: string[][] = [];
    emitter.onInvalidate((ids) => received.push(ids));

    emitter.emitInvalidation(['file:src/a.ts', 'file:src/b.ts']);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(['file:src/a.ts', 'file:src/b.ts']);
  });

  it('does not emit when nodeIds is empty', () => {
    const emitter = new InvalidationEmitter();
    const received: string[][] = [];
    emitter.onInvalidate((ids) => received.push(ids));

    emitter.emitInvalidation([]);

    expect(received).toHaveLength(0);
  });

  it('supports removing a listener with offInvalidate', () => {
    const emitter = new InvalidationEmitter();
    const received: string[][] = [];
    const listener = (ids: string[]) => received.push(ids);

    emitter.onInvalidate(listener);
    emitter.offInvalidate(listener);
    emitter.emitInvalidation(['file:src/x.ts']);

    expect(received).toHaveLength(0);
  });

  it('supports multiple listeners', () => {
    const emitter = new InvalidationEmitter();
    let count = 0;
    emitter.onInvalidate(() => count++);
    emitter.onInvalidate(() => count++);

    emitter.emitInvalidation(['a']);

    expect(count).toBe(2);
  });
});
