import type { Node, Edge, CaptureResult } from './types.js';

export interface SymbolExtractionResult {
  symbols: Node[];
  /** Reference edges for category→class associations. */
  categoryEdges: Edge[];
}

/**
 * Produces a deterministic symbol name for categories.
 * Follows Obj-C convention: ClassName(CategoryName).
 */
function categorySymbolName(className: string, categoryName: string): string {
  return `${className}(${categoryName})`;
}

/**
 * Builds a collision-free symbol id suffix.  v1 only tracks top-level symbols
 * so collisions are rare; we append `~<n>` when they do occur.
 */
function dedupedId(
  repoRelPath: string,
  name: string,
  seen: Map<string, number>,
): string {
  const base = `sym:${repoRelPath}#${name}`;
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}~${count}`;
}

/**
 * Extracts symbol nodes and category→class association edges from the captures
 * produced by running SYMBOL_QUERY + IMPL_QUERY against an Obj-C source file.
 *
 * Pure function – no disk / tree-sitter calls; inputs are pre-computed captures.
 */
export function extractSymbolNodes(
  captures: CaptureResult[],
  repoRelPath: string,
): SymbolExtractionResult {
  const symbols: Node[] = [];
  const categoryEdges: Edge[] = [];
  const seen = new Map<string, number>();

  // Pair up category captures: cat-class and cat-name always appear together
  // in sequence from the same node. Collect by scanning for adjacent pairs.
  const catClasses: Array<{ text: string; row: number; col: number }> = [];
  const catNames: Array<{ text: string; row: number; col: number }> = [];
  const catImplClasses: Array<{ text: string; row: number; col: number }> = [];
  const catImplNames: Array<{ text: string; row: number; col: number }> = [];

  for (const cap of captures) {
    const { name, text, startPosition: sp } = cap;

    if (name === 'interface') {
      const id = dedupedId(repoRelPath, text, seen);
      symbols.push({
        id,
        kind: 'symbol',
        language: 'objc',
        name: text,
        symbolKind: 'class',
        file: repoRelPath,
        loc: { line: sp.row + 1, col: sp.column },
        exported: true,
      });
    } else if (name === 'protocol') {
      const id = dedupedId(repoRelPath, text, seen);
      symbols.push({
        id,
        kind: 'symbol',
        language: 'objc',
        name: text,
        symbolKind: 'protocol',
        file: repoRelPath,
        loc: { line: sp.row + 1, col: sp.column },
        exported: true,
      });
    } else if (name === 'macro') {
      const id = dedupedId(repoRelPath, text, seen);
      symbols.push({
        id,
        kind: 'symbol',
        language: 'objc',
        name: text,
        symbolKind: 'macro',
        file: repoRelPath,
        loc: { line: sp.row + 1, col: sp.column },
        exported: true,
      });
    } else if (name === 'cat-class') {
      catClasses.push({ text, row: sp.row, col: sp.column });
    } else if (name === 'cat-name') {
      catNames.push({ text, row: sp.row, col: sp.column });
    } else if (name === 'cat-impl-class') {
      catImplClasses.push({ text, row: sp.row, col: sp.column });
    } else if (name === 'cat-impl-name') {
      catImplNames.push({ text, row: sp.row, col: sp.column });
    }
  }

  // Pair @interface ClassName (Category) captures
  const catCount = Math.min(catClasses.length, catNames.length);
  for (let i = 0; i < catCount; i++) {
    const cls = catClasses[i]!;
    const cat = catNames[i]!;
    const symName = categorySymbolName(cls.text, cat.text);
    const id = dedupedId(repoRelPath, symName, seen);
    symbols.push({
      id,
      kind: 'symbol',
      language: 'objc',
      name: symName,
      symbolKind: 'class',
      file: repoRelPath,
      loc: { line: cls.row + 1, col: cls.col },
      exported: true,
    });
    // Category→class association edge (best-effort, may be unresolved)
    categoryEdges.push({
      from: id,
      to: `sym:?#${cls.text}`,  // resolved by orchestrator if class is in graph
      kind: 'reference',
      targetType: 'symbol',
      resolution: 'unresolved',
      loc: { line: cls.row + 1, col: cls.col },
    });
  }

  // @implementation Foo (Bar) → reference from the file to the implemented class; no new symbol.
  const implCount = Math.min(catImplClasses.length, catImplNames.length);
  for (let i = 0; i < implCount; i++) {
    const cls = catImplClasses[i]!;
    categoryEdges.push({
      from: `file:${repoRelPath}`,
      to: `sym:?#${cls.text}`,
      kind: 'reference',
      targetType: 'symbol',
      resolution: 'unresolved',
      loc: { line: cls.row + 1, col: cls.col },
    });
  }

  // Stable ordering: sort symbols by id then by loc
  symbols.sort((a, b) => a.id.localeCompare(b.id));

  return { symbols, categoryEdges };
}

/**
 * Converts @class forward declarations into best-effort reference edges.
 * The target symbol is unresolved (we don't know which file declares it).
 */
export function extractForwardDeclEdges(
  captures: CaptureResult[],
  repoRelPath: string,
): Edge[] {
  return captures
    .filter((c) => c.name === 'forward-class')
    .map((c) => ({
      from: `file:${repoRelPath}`,
      to: `sym:?#${c.text}`,
      kind: 'reference' as const,
      targetType: 'symbol' as const,
      resolution: 'unresolved' as const,
      loc: { line: c.startPosition.row + 1, col: c.startPosition.column },
    }));
}

