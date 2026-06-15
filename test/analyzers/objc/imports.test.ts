import { describe, it, expect } from 'vitest';
import { extractImportEdges } from '../../../src/analyzers/objc/imports.js';
import { cap, StubResolver } from './helpers.js';

const FILE = 'fixtures/objc/Habitat.h';

describe('extractImportEdges — @import module (framework-import)', () => {
  it('emits external leaf node and wildcard import edge', () => {
    const caps = [cap('framework-import', 'Foundation', 0)];
    const resolver = new StubResolver();
    const { edges, externalNodes } = extractImportEdges(caps, FILE, resolver);

    expect(externalNodes).toHaveLength(1);
    expect(externalNodes[0]!.id).toBe('ext:objc:Foundation');
    expect(externalNodes[0]!.kind).toBe('external');
    expect(externalNodes[0]!.language).toBe('objc');

    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe(`file:${FILE}`);
    expect(edges[0]!.to).toBe('ext:objc:Foundation');
    expect(edges[0]!.kind).toBe('import');
    expect(edges[0]!.wildcard).toBe(true);
    expect(edges[0]!.targetType).toBe('external');

    // Resolver not called for @import (always external)
    expect(resolver.calls).toHaveLength(0);
  });

  it('deduplicates multiple @import of the same framework', () => {
    const caps = [
      cap('framework-import', 'Foundation', 0),
      cap('framework-import', 'Foundation', 1),
    ];
    const { externalNodes, edges } = extractImportEdges(caps, FILE, new StubResolver());
    expect(externalNodes).toHaveLength(1);
    expect(edges).toHaveLength(2);  // two import edges, one external node
  });
});

describe('extractImportEdges — quoted #import (local file)', () => {
  it('resolves to file edge when resolver succeeds', () => {
    const caps = [cap('quoted-import', '"Animal.h"', 5)];
    const resolver = new StubResolver().addRule('Animal.h', {
      kind: 'file',
      repoRelPath: 'fixtures/objc/Animal.h',
    });

    const { edges, externalNodes } = extractImportEdges(caps, FILE, resolver);

    expect(externalNodes).toHaveLength(0);
    expect(edges).toHaveLength(1);
    expect(edges[0]!.to).toBe('file:fixtures/objc/Animal.h');
    expect(edges[0]!.resolution).toBe('resolved');
    expect(edges[0]!.targetType).toBe('file');

    expect(resolver.calls[0]!.quoted).toBe(true);
    expect(resolver.calls[0]!.spec).toBe('Animal.h');
  });

  it('emits unresolved edge when resolver returns null', () => {
    const caps = [cap('quoted-import', '"missing.h"', 2)];
    const { edges } = extractImportEdges(caps, FILE, new StubResolver());
    expect(edges[0]!.resolution).toBe('unresolved');
    expect(edges[0]!.to).toBe('ext:objc:missing.h');
  });
});

describe('extractImportEdges — angled #import (framework/system)', () => {
  it('emits external leaf for angled import outside project', () => {
    const caps = [cap('angled-import', '<UIKit/UIKit.h>', 3)];
    const resolver = new StubResolver().addRule('UIKit/UIKit.h', {
      kind: 'external',
      spec: 'UIKit/UIKit.h',
    });

    const { edges, externalNodes } = extractImportEdges(caps, FILE, resolver);
    expect(externalNodes[0]!.id).toBe('ext:objc:UIKit');
    expect(externalNodes[0]!.name).toBe('UIKit');
    expect(edges[0]!.resolution).toBe('unresolved');
    expect(edges[0]!.targetType).toBe('external');
    expect(resolver.calls[0]!.quoted).toBe(false);
  });
});

describe('extractImportEdges — angled #include (C header)', () => {
  it('treats angled #include like angled #import', () => {
    const caps = [cap('angled-include', '<stdlib.h>', 1)];
    const resolver = new StubResolver().addRule('stdlib.h', {
      kind: 'external',
      spec: 'stdlib.h',
    });

    const { edges } = extractImportEdges(caps, FILE, resolver);
    expect(edges[0]!.targetType).toBe('external');
  });
});

describe('extractImportEdges — stable ordering', () => {
  it('edges are sorted by line then column', () => {
    const caps = [
      cap('framework-import', 'UIKit', 5),
      cap('framework-import', 'Foundation', 0),
      cap('framework-import', 'MapKit', 2),
    ];
    const { edges } = extractImportEdges(caps, FILE, new StubResolver());
    const lines = edges.map((e) => e.loc!.line);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });
});
