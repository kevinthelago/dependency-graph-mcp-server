import { describe, it, expect } from 'vitest';
import { extractSymbolNodes, extractForwardDeclEdges } from '../../../src/analyzers/objc/symbols.js';
import { cap } from './helpers.js';

const FILE = 'fixtures/objc/Animal.h';

describe('extractSymbolNodes — @interface', () => {
  it('emits a class symbol', () => {
    const caps = [cap('interface', 'Animal', 10, 1)];
    const { symbols } = extractSymbolNodes(caps, FILE);
    expect(symbols).toHaveLength(1);
    const [s] = symbols;
    expect(s!.id).toBe(`sym:${FILE}#Animal`);
    expect(s!.kind).toBe('symbol');
    expect(s!.symbolKind).toBe('class');
    expect(s!.language).toBe('objc');
    expect(s!.file).toBe(FILE);
    expect(s!.loc).toEqual({ line: 11, col: 1 });
    expect(s!.exported).toBe(true);
  });

  it('handles multiple @interface declarations with dedup', () => {
    // Two @interface with the same name → second gets ~1 suffix
    const caps = [cap('interface', 'Foo', 0), cap('interface', 'Foo', 5)];
    const { symbols } = extractSymbolNodes(caps, FILE);
    expect(symbols).toHaveLength(2);
    expect(symbols.map((s) => s.id)).toContain(`sym:${FILE}#Foo`);
    expect(symbols.map((s) => s.id)).toContain(`sym:${FILE}#Foo~1`);
  });
});

describe('extractSymbolNodes — @protocol', () => {
  it('emits a protocol symbol', () => {
    const caps = [cap('protocol', 'Locomotion', 5)];
    const { symbols } = extractSymbolNodes(caps, FILE);
    expect(symbols[0]!.symbolKind).toBe('protocol');
    expect(symbols[0]!.id).toBe(`sym:${FILE}#Locomotion`);
  });
});

describe('extractSymbolNodes — #define macro', () => {
  it('emits a macro symbol', () => {
    const caps = [cap('macro', 'ANIMAL_MAX_LEGS', 3)];
    const { symbols } = extractSymbolNodes(caps, FILE);
    expect(symbols[0]!.symbolKind).toBe('macro');
    expect(symbols[0]!.id).toBe(`sym:${FILE}#ANIMAL_MAX_LEGS`);
  });
});

describe('extractSymbolNodes — category @interface', () => {
  it('emits a category class symbol and category→class reference edge', () => {
    const caps = [
      cap('cat-class', 'Animal', 0),
      cap('cat-name', 'Training', 0),
    ];
    const { symbols, categoryEdges } = extractSymbolNodes(caps, FILE);

    expect(symbols).toHaveLength(1);
    expect(symbols[0]!.id).toBe(`sym:${FILE}#Animal(Training)`);
    expect(symbols[0]!.name).toBe('Animal(Training)');
    expect(symbols[0]!.symbolKind).toBe('class');

    expect(categoryEdges).toHaveLength(1);
    const edge = categoryEdges[0]!;
    expect(edge.from).toBe(`sym:${FILE}#Animal(Training)`);
    expect(edge.to).toBe('sym:?#Animal');
    expect(edge.kind).toBe('reference');
    expect(edge.resolution).toBe('unresolved');
  });
});

describe('extractSymbolNodes — category @implementation', () => {
  it('emits only a file→class edge (no new symbol)', () => {
    const caps = [
      cap('cat-impl-class', 'Animal', 20),
      cap('cat-impl-name', 'Training', 20),
    ];
    const { symbols, categoryEdges } = extractSymbolNodes(caps, FILE);
    expect(symbols).toHaveLength(0);
    expect(categoryEdges).toHaveLength(1);
    expect(categoryEdges[0]!.from).toBe(`file:${FILE}`);
    expect(categoryEdges[0]!.to).toBe('sym:?#Animal');
    expect(categoryEdges[0]!.resolution).toBe('unresolved');
  });
});

describe('extractSymbolNodes — stable ordering', () => {
  it('symbols are sorted by id', () => {
    const caps = [
      cap('interface', 'Zoo', 10),
      cap('interface', 'Animal', 0),
      cap('protocol', 'Movable', 5),
    ];
    const { symbols } = extractSymbolNodes(caps, FILE);
    const ids = symbols.map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
  });
});

describe('extractForwardDeclEdges', () => {
  it('emits an unresolved reference edge for each @class forward decl', () => {
    const caps = [cap('forward-class', 'Animal', 2), cap('forward-class', 'Habitat', 3)];
    const edges = extractForwardDeclEdges(caps, FILE);
    expect(edges).toHaveLength(2);
    expect(edges[0]!.to).toBe('sym:?#Animal');
    expect(edges[1]!.to).toBe('sym:?#Habitat');
    expect(edges.every((e) => e.kind === 'reference')).toBe(true);
    expect(edges.every((e) => e.resolution === 'unresolved')).toBe(true);
    expect(edges.every((e) => e.from === `file:${FILE}`)).toBe(true);
  });
});
