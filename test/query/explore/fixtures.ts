/**
 * In-memory graphology graph fixture for explore-structure tests.
 *
 * Graph layout:
 *
 *   file:src/a.ts  → (import) → file:src/b.ts
 *   file:src/a.ts  → (import) → file:src/c.ts
 *   file:src/a.ts  → (import) → ext:ts:lodash
 *   file:src/b.ts  → (import) → file:src/c.ts
 *   file:src/cycle-x.ts → (import) → file:src/cycle-y.ts
 *   file:src/cycle-y.ts → (import) → file:src/cycle-x.ts
 *   sym:src/a.ts#funcA → (reference) → sym:src/b.ts#funcB
 *
 * File nodes: a.ts, b.ts, c.ts, cycle-x.ts, cycle-y.ts  (5 total, all TypeScript)
 * Symbol nodes: funcA, funcB  (2 total)
 * External nodes: ext:ts:lodash  (1 total)
 * Edges: 7 total
 * File SCCs of size > 1: 1  (cycle-x ↔ cycle-y)
 * Top hotspot (by fanIn): file:src/c.ts (fanIn = 2 from a and b)
 */

import { DirectedGraph } from 'graphology';

export function buildFixtureGraph(): DirectedGraph {
  const g = new DirectedGraph();

  // File nodes
  g.addNode('file:src/a.ts', {
    kind: 'file',
    language: 'ts',
    name: 'src/a.ts',
  });
  g.addNode('file:src/b.ts', {
    kind: 'file',
    language: 'ts',
    name: 'src/b.ts',
  });
  g.addNode('file:src/c.ts', {
    kind: 'file',
    language: 'ts',
    name: 'src/c.ts',
  });
  g.addNode('file:src/cycle-x.ts', {
    kind: 'file',
    language: 'ts',
    name: 'src/cycle-x.ts',
  });
  g.addNode('file:src/cycle-y.ts', {
    kind: 'file',
    language: 'ts',
    name: 'src/cycle-y.ts',
  });

  // Symbol nodes
  g.addNode('sym:src/a.ts#funcA', {
    kind: 'symbol',
    language: 'ts',
    name: 'funcA',
    symbolKind: 'function',
    file: 'src/a.ts',
    exported: true,
  });
  g.addNode('sym:src/b.ts#funcB', {
    kind: 'symbol',
    language: 'ts',
    name: 'funcB',
    symbolKind: 'function',
    file: 'src/b.ts',
    exported: true,
  });

  // External node
  g.addNode('ext:ts:lodash', {
    kind: 'external',
    language: 'ts',
    name: 'lodash',
  });

  // File import edges
  g.addEdge('file:src/a.ts', 'file:src/b.ts', {
    kind: 'import',
    targetType: 'file',
    resolution: 'resolved',
  });
  g.addEdge('file:src/a.ts', 'file:src/c.ts', {
    kind: 'import',
    targetType: 'file',
    resolution: 'resolved',
  });
  g.addEdge('file:src/a.ts', 'ext:ts:lodash', {
    kind: 'import',
    targetType: 'external',
    resolution: 'unresolved',
  });
  g.addEdge('file:src/b.ts', 'file:src/c.ts', {
    kind: 'import',
    targetType: 'file',
    resolution: 'resolved',
  });

  // Cycle
  g.addEdge('file:src/cycle-x.ts', 'file:src/cycle-y.ts', {
    kind: 'import',
    targetType: 'file',
    resolution: 'resolved',
  });
  g.addEdge('file:src/cycle-y.ts', 'file:src/cycle-x.ts', {
    kind: 'import',
    targetType: 'file',
    resolution: 'resolved',
  });

  // Symbol reference edge
  g.addEdge('sym:src/a.ts#funcA', 'sym:src/b.ts#funcB', {
    kind: 'reference',
    targetType: 'symbol',
    resolution: 'resolved',
  });

  return g;
}

export function buildEmptyGraph(): DirectedGraph {
  return new DirectedGraph();
}
