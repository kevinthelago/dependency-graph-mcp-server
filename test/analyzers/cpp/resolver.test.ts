/**
 * Tests for the C/C++ include resolver (cpp-1, issue #57).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { IncludeResolver, buildResolver } from '../../../src/analyzers/cpp/resolver.js';

// ─────────────────────────────────────────────────────────────────────────────
// Temp project setup
// ─────────────────────────────────────────────────────────────────────────────

let projectRoot: string;

function tempDir(suffix: string): string {
  const dir = join(tmpdir(), `resolver-test-${suffix}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

beforeAll(() => {
  projectRoot = tempDir('basic');

  // Basic project layout
  mkdirSync(join(projectRoot, 'include'), { recursive: true });
  mkdirSync(join(projectRoot, 'src'), { recursive: true });
  writeFileSync(join(projectRoot, 'include', 'util.h'), '// util\n');
  writeFileSync(join(projectRoot, 'src', 'helper.h'), '// helper\n');
  writeFileSync(join(projectRoot, 'src', 'main.c'), '// main\n');
});

// ─────────────────────────────────────────────────────────────────────────────
// IncludeResolver unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('IncludeResolver', () => {
  describe('quoted include — relative search first', () => {
    it('resolves a sibling header via relative path', () => {
      const resolver = new IncludeResolver({
        projectRoot,
        includeDirs: [],
      });
      const result = resolver.resolve('helper.h', join(projectRoot, 'src', 'main.c'), true);
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe(resolve(projectRoot, 'src', 'helper.h'));
    });

    it('falls through to include dirs when not found relative', () => {
      const resolver = new IncludeResolver({
        projectRoot,
        includeDirs: [join(projectRoot, 'include')],
      });
      const result = resolver.resolve('util.h', join(projectRoot, 'src', 'main.c'), true);
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe(resolve(projectRoot, 'include', 'util.h'));
    });

    it('returns external for a file not found anywhere', () => {
      const resolver = new IncludeResolver({ projectRoot, includeDirs: [] });
      const result = resolver.resolve('missing.h', join(projectRoot, 'src', 'main.c'), true);
      expect(result.isExternal).toBe(true);
      expect(result.resolvedPath).toBeNull();
    });
  });

  describe('angled include — dirs only, no relative search', () => {
    it('does NOT search relative to the including file', () => {
      const resolver = new IncludeResolver({
        projectRoot,
        includeDirs: [], // no include dirs
      });
      // helper.h exists in src/ but angled includes don't search relatively
      const result = resolver.resolve('helper.h', join(projectRoot, 'src', 'main.c'), false);
      expect(result.isExternal).toBe(true);
      expect(result.resolvedPath).toBeNull();
    });

    it('resolves via include dirs for angled includes', () => {
      const resolver = new IncludeResolver({
        projectRoot,
        includeDirs: [join(projectRoot, 'include')],
      });
      const result = resolver.resolve('util.h', join(projectRoot, 'src', 'main.c'), false);
      expect(result.isExternal).toBe(false);
      expect(result.resolvedPath).toBe(resolve(projectRoot, 'include', 'util.h'));
    });

    it('marks system headers as external', () => {
      const resolver = new IncludeResolver({ projectRoot, includeDirs: [] });
      const result = resolver.resolve('stdio.h', join(projectRoot, 'src', 'main.c'), false);
      expect(result.isExternal).toBe(true);
      expect(result.resolvedPath).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildResolver — compile_commands.json
// ─────────────────────────────────────────────────────────────────────────────

describe('buildResolver — compile_commands.json', () => {
  it('reads -I flags from compile_commands.json', () => {
    const root = tempDir('cc');
    mkdirSync(join(root, 'myinc'), { recursive: true });
    writeFileSync(join(root, 'myinc', 'lib.h'), '');
    writeFileSync(join(root, 'main.c'), '');

    const ccPath = join(root, 'compile_commands.json');
    writeFileSync(
      ccPath,
      JSON.stringify([
        {
          directory: root,
          command: `gcc -I${join(root, 'myinc')} -c main.c`,
          file: join(root, 'main.c'),
        },
      ]),
    );

    const resolver = buildResolver({ projectRoot: root }, join(root, 'main.c'));
    const result = resolver.resolve('lib.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(false);
    expect(result.resolvedPath).toBe(join(root, 'myinc', 'lib.h'));

    rmSync(root, { recursive: true, force: true });
  });

  it('reads -D defines from compile_commands.json', () => {
    const root = tempDir('cc-defines');
    writeFileSync(join(root, 'main.c'), '');
    writeFileSync(
      join(root, 'compile_commands.json'),
      JSON.stringify([
        {
          directory: root,
          arguments: ['gcc', '-DFOO=42', '-DBAR', '-c', 'main.c'],
          file: 'main.c',
        },
      ]),
    );

    const resolver = buildResolver({ projectRoot: root });
    expect(resolver.defines['FOO']).toBe('42');
    expect(resolver.defines['BAR']).toBe('1');

    rmSync(root, { recursive: true, force: true });
  });

  it('tries build/compile_commands.json as fallback', () => {
    const root = tempDir('cc-build');
    mkdirSync(join(root, 'build'), { recursive: true });
    mkdirSync(join(root, 'inc'), { recursive: true });
    writeFileSync(join(root, 'inc', 'dep.h'), '');
    writeFileSync(join(root, 'main.c'), '');
    writeFileSync(
      join(root, 'build', 'compile_commands.json'),
      JSON.stringify([
        {
          directory: root,
          command: `gcc -I${join(root, 'inc')} -c main.c`,
          file: join(root, 'main.c'),
        },
      ]),
    );

    const resolver = buildResolver({ projectRoot: root });
    const result = resolver.resolve('dep.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildResolver — CMake fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('buildResolver — CMake light fallback', () => {
  it('parses include_directories() from CMakeLists.txt', () => {
    const root = tempDir('cmake');
    mkdirSync(join(root, 'myinc'), { recursive: true });
    writeFileSync(join(root, 'myinc', 'cmake_lib.h'), '');
    writeFileSync(
      join(root, 'CMakeLists.txt'),
      `cmake_minimum_required(VERSION 3.10)\nproject(Test)\ninclude_directories(myinc)\n`,
    );

    const resolver = buildResolver({ projectRoot: root });
    const result = resolver.resolve('cmake_lib.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildResolver — convention fallback
// ─────────────────────────────────────────────────────────────────────────────

describe('buildResolver — convention dir fallback', () => {
  it('uses <root>/include when no other config exists', () => {
    const root = tempDir('convention');
    mkdirSync(join(root, 'include'), { recursive: true });
    writeFileSync(join(root, 'include', 'conv.h'), '');

    const resolver = buildResolver({ projectRoot: root });
    const result = resolver.resolve('conv.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });

  it('uses configuredIncludeDirs from ctx when provided', () => {
    const root = tempDir('ctx-dirs');
    mkdirSync(join(root, 'custom'), { recursive: true });
    writeFileSync(join(root, 'custom', 'ctx.h'), '');

    const resolver = buildResolver({
      projectRoot: root,
      configuredIncludeDirs: [join(root, 'custom')],
    });
    const result = resolver.resolve('ctx.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(false);

    rmSync(root, { recursive: true, force: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Outside-project detection
// ─────────────────────────────────────────────────────────────────────────────

describe('outside-project detection', () => {
  it('marks a header found outside projectRoot as external', () => {
    const outer = tempDir('outer');
    const root = tempDir('inner');
    writeFileSync(join(outer, 'system.h'), '');

    const resolver = new IncludeResolver({
      projectRoot: root,
      includeDirs: [outer],
    });
    const result = resolver.resolve('system.h', join(root, 'main.c'), false);
    expect(result.isExternal).toBe(true);
    expect(result.resolvedPath).toBeNull();

    rmSync(outer, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });
});
