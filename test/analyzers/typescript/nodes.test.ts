import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';
import * as path from 'node:path';
import { extractNodes } from '../../../src/analyzers/typescript/nodes.js';

const FIXTURE_ROOT = path.resolve('fixtures/ts/simple');

function parseSource(text: string, fileName = '/project/src/mod.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
}

describe('extractNodes', () => {
  it('creates a file node with correct id and kind', () => {
    const sf = parseSource('export const x = 1;', '/project/src/mod.ts');
    const { file } = extractNodes(sf, '/project');
    expect(file.id).toBe('file:src/mod.ts');
    expect(file.kind).toBe('file');
    expect(file.language).toBe('ts');
    expect(file.name).toBe('src/mod.ts');
  });

  it('extracts function declarations with export flag', () => {
    const sf = parseSource(`
export function greet(name: string): string { return name; }
function internal(): void {}
`);
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols).toHaveLength(2);
    const greet = symbols.find((s) => s.name === 'greet');
    expect(greet?.symbolKind).toBe('function');
    expect(greet?.exported).toBe(true);
    const internal = symbols.find((s) => s.name === 'internal');
    expect(internal?.exported).toBe(false);
  });

  it('extracts class declarations', () => {
    const sf = parseSource('export class MyClass {}');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.symbolKind).toBe('class');
    expect(symbols[0]!.name).toBe('MyClass');
  });

  it('extracts variable statements (all declarators)', () => {
    const sf = parseSource('export const a = 1, b = 2;');
    const { symbols } = extractNodes(sf, '/project');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('extracts interface declarations', () => {
    const sf = parseSource('export interface Foo { x: number; }');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.symbolKind).toBe('interface');
  });

  it('extracts type aliases', () => {
    const sf = parseSource('export type Bar = string | number;');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.symbolKind).toBe('type');
  });

  it('extracts enum declarations', () => {
    const sf = parseSource('export enum Direction { Up, Down }');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.symbolKind).toBe('enum');
  });

  it('extracts namespace/module declarations', () => {
    const sf = parseSource('export namespace NS { export const x = 1; }');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.symbolKind).toBe('module');
  });

  it('symbols include loc', () => {
    const sf = parseSource('export function f() {}');
    const { symbols } = extractNodes(sf, '/project');
    expect(symbols[0]!.loc).toBeDefined();
    expect(symbols[0]!.loc?.line).toBeGreaterThan(0);
  });

  it('symbol ids include file path and name', () => {
    const sf = parseSource('export function myFn() {}', '/root/src/api.ts');
    const { symbols } = extractNodes(sf, '/root');
    expect(symbols[0]!.id).toBe('sym:src/api.ts#myFn');
  });

  it('deterministic ordering: same source -> same symbol list', () => {
    const src = `
export function a() {}
export function b() {}
export const c = 1;
`;
    const sf1 = parseSource(src);
    const sf2 = parseSource(src);
    const { symbols: s1 } = extractNodes(sf1, '/project');
    const { symbols: s2 } = extractNodes(sf2, '/project');
    expect(s1.map((s) => s.id)).toEqual(s2.map((s) => s.id));
  });

  it('parses the simple fixture correctly', () => {
    // Read from disk to validate against a real file
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
    const p = path.join(FIXTURE_ROOT, 'src/utils.ts');
    const text = fs.readFileSync(p, 'utf8');
    const sf = parseSource(text, p);
    const { file, symbols } = extractNodes(sf, FIXTURE_ROOT);
    expect(file.kind).toBe('file');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('formatNumber');
    expect(names).toContain('FormatOptions');
    expect(names).toContain('Formatter');
    expect(names).toContain('RoundingMode');
  });
});
