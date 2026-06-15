/**
 * C/C++ language analyser — cpp-2 (issue #58).
 *
 * Grammar dispatch:
 *   .c                  → C grammar
 *   .cpp/.cxx/.cc/.c++  → C++ grammar
 *   .h/.hpp/.hxx        → heuristic (C++ keywords present → cpp, else c)
 *
 * Primary output: include graph edges.
 * Secondary: top-level symbol declarations.
 * Preprocessor is not evaluated (#if / #ifdef branches are all included).
 */

import { extname, basename } from 'node:path';
import type { LanguageAnalyzer, ProjectContext, AnalysisFragment } from '../types.js';
import { createGrammarParser, type GrammarLanguage } from '../tree-sitter/index.js';
import { buildResolver } from './resolver.js';
import { extractRawIncludes, buildIncludeEdges } from './includes.js';
import { extractNodes, type CppGrammarLanguage } from './nodes.js';
import { fileId } from '../../graph/node-id.js';
import type { Node, Language } from '../../graph/model.js';

// ─────────────────────────────────────────────────────────────────────────────
// Grammar selection
// ─────────────────────────────────────────────────────────────────────────────

const CPP_EXTS = new Set(['.cpp', '.cxx', '.cc', '.c++', '.C', '.mm']);
const C_EXTS = new Set(['.c', '.m']);
const HEADER_EXTS = new Set(['.h', '.hpp', '.hxx', '.h++', '.hh', '.H']);

const CPP_SIGNATURES = [
  /\bclass\s+\w/,
  /\bnamespace\s+(?:\w|{)/,
  /\btemplate\s*</,
  /\boperator\s*[^a-zA-Z_\s]/,
  /\bconstexpr\b/,
  /\bnullptr\b/,
  /\boverride\b/,
  /\bstatic_assert\s*\(/,
  /#include\s*<[a-z_]+>(?!\s*\/\/)/,
  /\bstd\s*::/,
];

function detectCppContent(content: string): boolean {
  return CPP_SIGNATURES.some((re) => re.test(content));
}

function selectGrammar(filePath: string, content: string): GrammarLanguage {
  const ext = extname(filePath).toLowerCase();
  if (CPP_EXTS.has(ext)) return 'cpp';
  if (C_EXTS.has(ext)) return 'c';
  if (HEADER_EXTS.has(ext)) return detectCppContent(content) ? 'cpp' : 'c';
  return 'c';
}

// ─────────────────────────────────────────────────────────────────────────────
// Analyser
// ─────────────────────────────────────────────────────────────────────────────

export class CppAnalyzer implements LanguageAnalyzer {
  readonly id = 'cpp';
  readonly version = '1';
  readonly extensions: string[] = [
    '.c', '.cpp', '.cxx', '.cc', '.c++',
    '.h', '.hpp', '.hxx', '.h++', '.hh',
  ];

  private project: ProjectContext | null = null;

  async init(project: ProjectContext): Promise<void> {
    this.project = project;
  }

  async analyzeFile(filePath: string, content: string): Promise<AnalysisFragment> {
    if (!this.project) {
      throw new Error('CppAnalyzer.init() must be called before analyzeFile()');
    }

    const grammar = selectGrammar(filePath, content);
    const parser = await createGrammarParser(grammar);
    const tree = parser.parse(content);
    const root = tree.rootNode;

    const rawDirs = this.project.config['includeDirs'];
    const resolverCtx = Array.isArray(rawDirs)
      ? { projectRoot: this.project.repoRoot, configuredIncludeDirs: rawDirs as string[] }
      : { projectRoot: this.project.repoRoot };

    const resolver = buildResolver(resolverCtx, filePath);

    const fileNode: Node = {
      id: fileId(filePath),
      kind: 'file',
      language: grammar as Language,
      name: basename(filePath),
      file: filePath,
    };

    const symbols = extractNodes(root, filePath, grammar as CppGrammarLanguage);

    const rawIncludes = extractRawIncludes(root);
    const { edges, imports } = buildIncludeEdges(rawIncludes, filePath, resolver);

    return { file: fileNode, symbols, edges, imports };
  }

  async dispose(): Promise<void> {
    this.project = null;
  }
}

/** Singleton instance for use in the registry. */
export const cppAnalyzer = new CppAnalyzer();
