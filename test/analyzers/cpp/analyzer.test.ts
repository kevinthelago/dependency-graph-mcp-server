/**
 * Unit tests for the C/C++ analyser (cpp-2, issue #58).
 */

import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CppAnalyzer } from '../../../src/analyzers/cpp/index.js';
import { fileId, externalId } from '../../../src/graph/node-id.js';

function tempProject(suffix: string): string {
  const dir = join(tmpdir(), `cpp-analyzer-${suffix}-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const analyzer = new CppAnalyzer();

// ─────────────────────────────────────────────────────────────────────────────
// Basic C analysis
// ─────────────────────────────────────────────────────────────────────────────

describe('C file analysis', () => {
  it('extracts file node with correct language', async () => {
    const root = tempProject('c-basic');
    const filePath = join(root, 'main.c');
    const content = 'int main(void) { return 0; }\n';

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    expect(result.file.language).toBe('c');
    expect(result.file.id).toBe(fileId(filePath));

    rmSync(root, { recursive: true, force: true });
  });

  it('extracts top-level function symbols', async () => {
    const root = tempProject('c-symbols');
    const filePath = join(root, 'lib.c');
    const content = `
int add(int a, int b) { return a + b; }
void reset(int *x) { *x = 0; }
static int internal(void) { return 42; }
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const names = result.symbols.map((n) => n.name);
    expect(names).toContain('add');
    expect(names).toContain('reset');
    expect(names).toContain('internal');

    rmSync(root, { recursive: true, force: true });
  });

  it('extracts struct and typedef symbols', async () => {
    const root = tempProject('c-struct');
    const filePath = join(root, 'types.h');
    const content = `
struct Point { int x; int y; };
typedef struct Point Point;
typedef int MyInt;
enum Color { RED, GREEN, BLUE };
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const names = result.symbols.map((n) => n.name);
    expect(names).toContain('Point');
    expect(names).toContain('MyInt');
    expect(names).toContain('Color');

    rmSync(root, { recursive: true, force: true });
  });

  it('extracts #define macros', async () => {
    const root = tempProject('c-macros');
    const filePath = join(root, 'config.h');
    const content = `
#define MAX_SIZE 256
#define MIN(a, b) ((a) < (b) ? (a) : (b))
#define DEBUG 1
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const names = result.symbols.map((n) => n.name);
    expect(names).toContain('MAX_SIZE');
    expect(names).toContain('MIN');
    expect(names).toContain('DEBUG');

    rmSync(root, { recursive: true, force: true });
  });

  it('emits external import for system include', async () => {
    const root = tempProject('c-system');
    const filePath = join(root, 'main.c');
    const content = '#include <stdio.h>\n#include <stdlib.h>\nint main(void){return 0;}\n';

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const extSpecifiers = result.imports
      .filter((i) => i.resolution === 'unresolved')
      .map((i) => i.specifier);
    expect(extSpecifiers).toContain('stdio.h');
    expect(extSpecifiers).toContain('stdlib.h');

    expect(result.edges.some((e) => e.resolution === 'unresolved' && e.to === externalId('stdio.h'))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });

  it('resolves quoted in-project include to a resolved file edge', async () => {
    const root = tempProject('c-inproject');
    mkdirSync(join(root, 'src'));
    const headerPath = join(root, 'src', 'util.h');
    const mainPath = join(root, 'src', 'main.c');
    writeFileSync(headerPath, 'int add(int a, int b);\n');
    writeFileSync(mainPath, '#include "util.h"\nint main(void){return 0;}\n');

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(
      mainPath,
      '#include "util.h"\nint main(void){return 0;}\n',
    );

    expect(result.edges.some((e) => e.resolution === 'resolved' && e.to === fileId(headerPath))).toBe(true);

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C++ analysis
// ─────────────────────────────────────────────────────────────────────────────

describe('C++ file analysis', () => {
  it('uses cpp grammar for .cpp files', async () => {
    const root = tempProject('cpp-grammar');
    const filePath = join(root, 'Foo.cpp');
    const content = `
#include <string>
class Foo {
public:
  void bar();
};
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    expect(result.file.language).toBe('cpp');

    rmSync(root, { recursive: true, force: true });
  });

  it('extracts class and namespace symbols', async () => {
    const root = tempProject('cpp-symbols');
    const filePath = join(root, 'shapes.hpp');
    const content = `
namespace geometry {
  class Shape { virtual double area() = 0; };
  class Circle : public Shape { double area() override; };
}
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const names = result.symbols.map((n) => n.name);
    expect(names).toContain('geometry');
    expect(names).toContain('Shape');
    expect(names).toContain('Circle');

    rmSync(root, { recursive: true, force: true });
  });

  it('uses cpp grammar for .hpp files with C++ content', async () => {
    const root = tempProject('cpp-hpp');
    const filePath = join(root, 'api.hpp');
    const content = `
#pragma once
#include <memory>
class Api {
  std::unique_ptr<int> impl_;
public:
  void doThing();
};
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    expect(result.file.language).toBe('cpp');
    const names = result.symbols.map((n) => n.name);
    expect(names).toContain('Api');

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// .h heuristic
// ─────────────────────────────────────────────────────────────────────────────

describe('.h file heuristic', () => {
  it('selects C grammar for a plain C header', async () => {
    const root = tempProject('h-c');
    const filePath = join(root, 'types.h');
    const content = `
#ifndef TYPES_H
#define TYPES_H
typedef struct { int x; } Point;
#endif
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);
    expect(result.file.language).toBe('c');

    rmSync(root, { recursive: true, force: true });
  });

  it('selects C++ grammar for a header with C++ keywords', async () => {
    const root = tempProject('h-cpp');
    const filePath = join(root, 'widget.h');
    const content = `
#pragma once
class Widget {
public:
  virtual void draw() = 0;
  constexpr int size() const { return 42; }
};
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);
    expect(result.file.language).toBe('cpp');

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Edge structure
// ─────────────────────────────────────────────────────────────────────────────

describe('edge structure', () => {
  it('symbols are returned for each top-level declaration', async () => {
    const root = tempProject('edges-symbols');
    const filePath = join(root, 'lib.c');
    const content = 'int foo(void) { return 1; }\nint bar(void) { return 2; }\n';

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    expect(result.symbols.length).toBeGreaterThanOrEqual(2);

    rmSync(root, { recursive: true, force: true });
  });

  it('import edges carry source location', async () => {
    const root = tempProject('edges-loc');
    const filePath = join(root, 'main.c');
    const content = '#include <stdio.h>\nint main(void) {}\n';

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const result = await analyzer.analyzeFile(filePath, content);

    const importEdge = result.edges.find((e) => e.kind === 'import');
    expect(importEdge?.loc).toBeDefined();
    expect(importEdge?.loc?.line).toBe(1);

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Determinism
// ─────────────────────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('produces identical output for the same input', async () => {
    const root = tempProject('determinism');
    const filePath = join(root, 'stable.c');
    const content = `
#include <stdio.h>
#define FOO 1
int a(void) { return 1; }
int b(void) { return 2; }
int c(void) { return 3; }
`.trim();

    await analyzer.init({ repoRoot: root, config: {}, resolveExternal: () => null });
    const r1 = await analyzer.analyzeFile(filePath, content);
    const r2 = await analyzer.analyzeFile(filePath, content);

    expect(r1.symbols.map((s) => s.id).sort().join(',')).toBe(
      r2.symbols.map((s) => s.id).sort().join(','),
    );
    expect(r1.edges.length).toBe(r2.edges.length);

    rmSync(root, { recursive: true, force: true });
  });
});
