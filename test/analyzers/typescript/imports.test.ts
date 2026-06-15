import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as path from 'node:path';
import { extractImports } from '../../../src/analyzers/typescript/imports.js';
import { packageName } from '../../../src/analyzers/typescript/imports.js';

const SIMPLE_ROOT = path.resolve('fixtures/ts/simple');
const PATHS_ROOT = path.resolve('fixtures/ts/paths-alias');

function makeHost(files: Record<string, string>): ts.ModuleResolutionHost {
  return {
    fileExists: (f) => f in files || ts.sys.fileExists(f),
    readFile: (f) => files[f] ?? ts.sys.readFile(f),
    directoryExists: ts.sys.directoryExists.bind(ts.sys),
    getDirectories: ts.sys.getDirectories.bind(ts.sys),
  };
}

function parse(text: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

describe('extractImports', () => {
  it('resolves a relative import to a file node', () => {
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'main.ts');
    const utilsPath = path.join(SIMPLE_ROOT, 'src', 'utils.ts');
    const text = `import { formatNumber } from './utils';`;
    const sf = parse(text, mainPath);
    const opts: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = makeHost({ [utilsPath]: 'export function formatNumber() {}' });

    const { edges, imports } = extractImports(sf, opts, host, SIMPLE_ROOT);

    expect(edges).toHaveLength(1);
    expect(edges[0]!.from).toBe('file:src/main.ts');
    expect(edges[0]!.to).toBe('file:src/utils.ts');
    expect(edges[0]!.kind).toBe('import');
    expect(edges[0]!.resolution).toBe('resolved');
    expect(imports[0]!.resolution).toBe('resolved');
    expect(imports[0]!.resolvedPath).toBe('src/utils.ts');
  });

  it('records unresolved imports', () => {
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'main.ts');
    const text = `import { foo } from 'nonexistent-xyz';`;
    const sf = parse(text, mainPath);
    const opts: ts.CompilerOptions = {};
    const host = makeHost({});

    const { edges, imports } = extractImports(sf, opts, host, SIMPLE_ROOT);
    expect(edges[0]!.resolution).toBe('unresolved');
    expect(imports[0]!.resolution).toBe('unresolved');
  });

  it('tags type-only imports', () => {
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'main.ts');
    const text = `import type { Foo } from './utils';`;
    const sf = parse(text, mainPath);
    const opts: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = makeHost({ [path.join(SIMPLE_ROOT, 'src', 'utils.ts')]: 'export type Foo = string;' });

    const { edges } = extractImports(sf, opts, host, SIMPLE_ROOT);
    expect(edges[0]!.typeOnly).toBe(true);
  });

  it('tags wildcard (namespace) imports', () => {
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'main.ts');
    const text = `import * as utils from './utils';`;
    const sf = parse(text, mainPath);
    const opts: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = makeHost({ [path.join(SIMPLE_ROOT, 'src', 'utils.ts')]: 'export const x = 1;' });

    const { edges } = extractImports(sf, opts, host, SIMPLE_ROOT);
    expect(edges[0]!.wildcard).toBe(true);
  });

  it('tags export-star as wildcard', () => {
    const mainPath = path.join(SIMPLE_ROOT, 'src', 'index.ts');
    const text = `export * from './utils';`;
    const sf = parse(text, mainPath);
    const opts: ts.CompilerOptions = { moduleResolution: ts.ModuleResolutionKind.Bundler };
    const host = makeHost({ [path.join(SIMPLE_ROOT, 'src', 'utils.ts')]: 'export const x = 1;' });

    const { edges } = extractImports(sf, opts, host, SIMPLE_ROOT);
    expect(edges[0]!.wildcard).toBe(true);
  });

  it('resolves path aliases', () => {
    // Uses real tsconfig from paths-alias fixture
    const fs = require('node:fs');
    const tsconfigPath = path.join(PATHS_ROOT, 'tsconfig.json');
    const readResult = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(
      readResult.config,
      ts.sys,
      PATHS_ROOT,
    );

    const indexPath = path.join(PATHS_ROOT, 'src', 'index.ts');
    const text = fs.readFileSync(indexPath, 'utf8');
    const sf = parse(text, indexPath);

    const { edges } = extractImports(sf, parsed.options, ts.sys, PATHS_ROOT);
    const resolvedTargets = edges
      .filter((e) => e.resolution === 'resolved')
      .map((e) => e.to);
    // Should resolve @lib/format -> src/lib/format.ts and @utils -> src/utils/index.ts
    expect(resolvedTargets.some((t) => t.includes('lib/format'))).toBe(true);
    expect(resolvedTargets.some((t) => t.includes('utils'))).toBe(true);
  });
});

describe('packageName', () => {
  it('handles simple packages', () => {
    expect(packageName('lodash')).toBe('lodash');
    expect(packageName('lodash/fp')).toBe('lodash');
  });

  it('handles scoped packages', () => {
    expect(packageName('@types/node')).toBe('@types/node');
    expect(packageName('@modelcontextprotocol/sdk')).toBe('@modelcontextprotocol/sdk');
    expect(packageName('@scope/pkg/subpath')).toBe('@scope/pkg');
  });
});
