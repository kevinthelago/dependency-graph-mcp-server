/**
 * Tree-sitter scaffold — web-tree-sitter (WASM) implementation.
 *
 * Uses web-tree-sitter so the parser works on any platform (no native build
 * required). Grammar WASM blobs are loaded from the tree-sitter-c and
 * tree-sitter-cpp packages, which ship them alongside their native prebuilds.
 *
 * Note: this file is owned by the analyze-python stream but was updated by the
 * analyze-cpp stream (migrated to web-tree-sitter; native tree-sitter bindings
 * are unavailable on node@24/win32 — agreed approach per contract).
 */

import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { Parser, Language } from 'web-tree-sitter';

const _require = createRequire(import.meta.url);

export type GrammarLanguage = 'c' | 'cpp';

/** Subset of the web-tree-sitter Node API used by this project. */
export interface TreeNode {
  readonly type: string;
  readonly text: string;
  readonly startPosition: Position;
  readonly endPosition: Position;
  readonly isNamed: boolean;
  readonly childCount: number;
  readonly children: readonly TreeNode[];
  readonly namedChildren: readonly TreeNode[];
  readonly parent: TreeNode | null;
  childForFieldName(name: string): TreeNode | null;
  childrenForFieldName(name: string): TreeNode[];
  namedChild(index: number): TreeNode | null;
  descendantsOfType(type: string | readonly string[]): TreeNode[];
}

export interface ParsedTree {
  readonly rootNode: TreeNode;
}

export interface Position {
  readonly row: number;    // 0-based
  readonly column: number; // 0-based
}

export interface GrammarParser {
  parse(source: string): ParsedTree;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

function getWebTreeSitterWasmPath(): string {
  // Resolve the main CJS entry; the .wasm file lives in the same directory.
  const entryPath = _require.resolve('web-tree-sitter');
  return join(dirname(entryPath), 'web-tree-sitter.wasm');
}

function getGrammarWasmPath(pkg: 'tree-sitter-c' | 'tree-sitter-cpp'): string {
  // The main entry resolves to <pkg-root>/bindings/node/index.js;
  // the .wasm file lives two levels up at the package root.
  const entryPath = _require.resolve(pkg);
  const pkgRoot = resolve(dirname(entryPath), '../..');
  const wasmName = pkg === 'tree-sitter-c' ? 'tree-sitter-c.wasm' : 'tree-sitter-cpp.wasm';
  return join(pkgRoot, wasmName);
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialisation (once)
// ─────────────────────────────────────────────────────────────────────────────

let webInitPromise: Promise<void> | null = null;

async function ensureInit(): Promise<void> {
  if (!webInitPromise) {
    const wasmPath = getWebTreeSitterWasmPath();
    webInitPromise = Parser.init({
      // locateFile tells Emscripten where to find the .wasm blob at runtime.
      locateFile: (_scriptName: string) => wasmPath,
    });
  }
  return webInitPromise;
}

// ─────────────────────────────────────────────────────────────────────────────
// Parser + language cache
// ─────────────────────────────────────────────────────────────────────────────

const languageCache = new Map<string, Language>();
const parserCache = new Map<string, GrammarParser>();

/**
 * Return a cached GrammarParser for the requested language.
 * Lazy-initialises the WASM runtime and grammar on first call.
 */
export async function createGrammarParser(language: GrammarLanguage): Promise<GrammarParser> {
  const cached = parserCache.get(language);
  if (cached) return cached;

  await ensureInit();

  let lang = languageCache.get(language);
  if (!lang) {
    const wasmPkg = language === 'c' ? 'tree-sitter-c' : 'tree-sitter-cpp';
    const wasmPath = getGrammarWasmPath(wasmPkg);
    lang = await Language.load(wasmPath);
    languageCache.set(language, lang);
  }

  const parser = new Parser();
  parser.setLanguage(lang);

  // Wrap to satisfy our GrammarParser interface (parse must return ParsedTree).
  const wrapper: GrammarParser = {
    parse(source: string): ParsedTree {
      const tree = parser.parse(source);
      if (!tree) throw new Error(`tree-sitter parse returned null for language=${language}`);
      return tree as unknown as ParsedTree;
    },
  };

  parserCache.set(language, wrapper);
  return wrapper;
}

/**
 * Hook type for include / module resolvers.
 * Return the absolute resolved path, or null if the import is external / unresolvable.
 */
export type ResolverHook = (
  importPath: string,
  fromFile: string,
  isSystem: boolean,
) => Promise<string | null>;

// Re-export the shared tree-sitter scaffold helpers for language analyzers.
export { loadGrammar, resolveGrammarPath, createParser } from './loader.js';
export type { Language } from './loader.js';
export { QueryRunner } from './query-runner.js';
export type { PatternMatch, CaptureResult } from './query-runner.js';
