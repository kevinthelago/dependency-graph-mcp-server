// ts-1: TypeScriptAnalyzer — LanguageAnalyzer implementation for TS/JS

import * as ts from 'typescript';
import * as path from 'node:path';
import type { LanguageAnalyzer, ProjectContext, AnalysisFragment } from '../types.js';
import { createTsProject, type TsProjectState } from './program.js';
import { extractNodes, toRelPath } from './nodes.js';
import { extractImports } from './imports.js';
import { extractReferences } from './references.js';
import { swapSnapshot } from './incremental.js';
import { fileId } from '../../graph/node-id.js';

export class TypeScriptAnalyzer implements LanguageAnalyzer {
  readonly id = 'typescript';
  readonly extensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
  readonly version = '1.0.0';

  private state: TsProjectState | null = null;
  private projectFileSet = new Set<string>();

  async init(project: ProjectContext): Promise<void> {
    this.state = createTsProject(project);
    this.projectFileSet = new Set(this.state.fileNames());
  }

  async analyzeFile(filePath: string, text: string): Promise<AnalysisFragment> {
    if (!this.state) throw new Error('TypeScriptAnalyzer not initialized — call init() first');

    const absPath = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(this.state.repoRoot, filePath);

    // ts-5: swap snapshot (incremental — no full rebuild)
    swapSnapshot(this.state, absPath, text);
    this.projectFileSet.add(absPath);

    const program = this.state.languageService.getProgram();
    if (!program) {
      return emptyFragment(absPath, this.state.repoRoot);
    }

    const sourceFile = program.getSourceFile(absPath);
    if (!sourceFile) {
      return emptyFragment(absPath, this.state.repoRoot);
    }

    const { file, symbols } = extractNodes(sourceFile, this.state.repoRoot);

    const { edges: importEdges, imports } = extractImports(
      sourceFile,
      this.state.compilerOptions,
      makeModuleResolutionHost(this.state),
      this.state.repoRoot,
    );

    const checker = program.getTypeChecker();
    const refEdges = extractReferences(
      sourceFile,
      checker,
      this.state.repoRoot,
      this.projectFileSet,
    );

    // Deterministic edge ordering: imports before references, then by (from, to)
    const edges = [...importEdges, ...refEdges].sort(edgeCompare);

    return { file, symbols, edges, imports };
  }

  async dispose(): Promise<void> {
    this.state?.languageService.dispose();
    this.state = null;
    this.projectFileSet.clear();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyFragment(absPath: string, repoRoot: string): AnalysisFragment {
  const relPath = toRelPath(absPath, repoRoot);
  const lang = /\.(ts|tsx|mts|cts)$/.test(absPath) ? 'ts' as const : 'js' as const;
  return {
    file: { id: fileId(relPath), kind: 'file', language: lang, name: relPath },
    symbols: [],
    edges: [],
    imports: [],
  };
}

function makeModuleResolutionHost(state: TsProjectState): ts.ModuleResolutionHost {
  const host: ts.ModuleResolutionHost = {
    fileExists: (f) => state.languageService.getProgram()?.getSourceFile(f) !== undefined || ts.sys.fileExists(f),
    readFile: (f) => ts.sys.readFile(f),
    directoryExists: ts.sys.directoryExists.bind(ts.sys),
    getDirectories: ts.sys.getDirectories.bind(ts.sys),
  };
  if (ts.sys.realpath) host.realpath = ts.sys.realpath.bind(ts.sys);
  return host;
}

function edgeCompare(a: { kind: string; from: string; to: string }, b: { kind: string; from: string; to: string }): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  return a.to < b.to ? -1 : a.to > b.to ? 1 : 0;
}
