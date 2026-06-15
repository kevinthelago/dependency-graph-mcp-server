/**
 * Python language analyzer.
 *
 * Implements LanguageAnalyzer using the shared tree-sitter scaffold.
 * Emits file + top-level symbol nodes and import edges per the graph-model
 * and language-analyzer contracts.
 *
 * See contracts/language-analyzer.md and contracts/graph-model.md.
 */

import { readFileSync } from 'fs'
import { join, dirname, resolve as resolvePath } from 'path'
import { fileURLToPath } from 'url'
import Parser from 'web-tree-sitter'

import type {
  LanguageAnalyzer,
  ProjectContext,
  AnalysisFragment,
  GraphNode,
  Edge,
  ImportRef,
} from '../types.js'
import { fileId, symbolId, externalId } from '../../graph/node-id.js'
import {
  loadGrammar,
  resolveGrammarPath,
  createParser,
  QueryRunner,
} from '../tree-sitter/index.js'
import type { Language } from '../tree-sitter/index.js'
import { buildFileNode, extractSymbols } from './nodes.js'
import {
  classifyAbsolute,
  resolveRelative,
  parseRelativeModule,
} from './imports.js'
import { resolveSourceRoots } from './config.js'

const QUERY_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'queries',
)

/** Load the tags.scm query source once at module init time. */
const TAGS_QUERY = readFileSync(join(QUERY_DIR, 'tags.scm'), 'utf8')

export interface PythonAnalyzerOptions {
  /** Absolute path to tree-sitter-python.wasm. Auto-detected if omitted. */
  wasmPath?: string
  /** Directory containing grammar .wasm files. Overrides env var. */
  wasmDir?: string
}

export class PythonAnalyzer implements LanguageAnalyzer {
  readonly id = 'python'
  readonly extensions = ['.py', '.pyi']
  readonly version = '1.0.0'

  private grammar: Language | null = null
  private queryRunner: QueryRunner | null = null
  private project: ProjectContext | null = null
  private sourceRoots: string[] = []

  constructor(private readonly opts: PythonAnalyzerOptions = {}) {}

  async init(project: ProjectContext): Promise<void> {
    this.project = project

    const wasmPath = resolveGrammarPath('tree-sitter-python', {
      wasmPath: this.opts.wasmPath,
      wasmDir: this.opts.wasmDir,
    })
    this.grammar = await loadGrammar(wasmPath)
    this.queryRunner = new QueryRunner(this.grammar)
    this.sourceRoots = resolveSourceRoots(project.repoRoot, project.config)
  }

  async analyzeFile(
    path: string,
    text: string,
  ): Promise<AnalysisFragment> {
    if (!this.grammar || !this.queryRunner || !this.project) {
      throw new Error('PythonAnalyzer.init() must be called before analyzeFile()')
    }

    const parser = await createParser(this.grammar)
    const tree = parser.parse(text)

    const matches = this.queryRunner.matches(TAGS_QUERY, tree)

    // ── File node ──────────────────────────────────────────────────────────
    const fileNode = buildFileNode(path)

    // ── Symbol nodes ───────────────────────────────────────────────────────
    const symbols = extractSymbols(matches, path)

    // ── Import edges + ImportRefs ──────────────────────────────────────────
    const { edges, imports } = this.buildImports(matches, path)

    // Ordering: deterministic — symbols in document order (preserved by
    // extractSymbols), imports in document order (preserved below).
    return { file: fileNode, symbols, edges, imports }
  }

  async dispose(): Promise<void> {
    this.queryRunner?.dispose()
    this.queryRunner = null
    this.grammar = null
    this.project = null
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private buildImports(
    matches: ReturnType<QueryRunner['matches']>,
    fromFile: string,
  ): { edges: Edge[]; imports: ImportRef[] } {
    const ctx = this.project!
    const edges: Edge[] = []
    const imports: ImportRef[] = []

    // Deduplicate import edges by target id (same module imported twice in one
    // file → one edge; the loc of the first occurrence is used).
    const seen = new Set<string>()

    const addImport = (
      specifier: string,
      wildcard: boolean,
      loc: { line: number; col: number },
      resolved:
        | { kind: 'file'; repoRelPath: string }
        | { kind: 'external'; spec: string }
        | { kind: 'unresolved' },
    ): void => {
      const dedupeKey = specifier + '|' + (resolved.kind === 'file' ? resolved.repoRelPath : resolved.kind === 'external' ? resolved.spec : 'unresolved')
      if (seen.has(dedupeKey)) return
      seen.add(dedupeKey)

      if (resolved.kind === 'file') {
        const toId = fileId(resolved.repoRelPath)
        if (!edges.some((e) => e.to === toId && e.kind === 'import')) {
          edges.push({
            from: fileId(fromFile),
            to: toId,
            kind: 'import',
            targetType: 'file',
            wildcard,
            resolution: 'resolved',
            loc,
          })
        }
        imports.push({
          specifier,
          resolvedPath: resolved.repoRelPath,
          isExternal: false,
          isUnresolved: false,
          wildcard,
        })
      } else if (resolved.kind === 'external') {
        const extNode = this.ensureExternal(resolved.spec)
        edges.push({
          from: fileId(fromFile),
          to: extNode.id,
          kind: 'import',
          targetType: 'external',
          wildcard,
          resolution: 'resolved',
          loc,
        })
        imports.push({
          specifier,
          isExternal: true,
          isUnresolved: false,
          wildcard,
        })
      } else {
        // unresolved
        edges.push({
          from: fileId(fromFile),
          to: `unresolved:${specifier}`,
          kind: 'import',
          targetType: 'file',
          wildcard,
          resolution: 'unresolved',
          loc,
        })
        imports.push({
          specifier,
          isExternal: false,
          isUnresolved: true,
          wildcard,
        })
      }
    }

    for (const match of matches) {
      // Each match corresponds to one import pattern in the query.
      // We reconstruct the full specifier + classification from the captures.
      const caps = Object.fromEntries(
        match.captures.map((c) => [c.name, c]),
      )

      // ── import foo (absolute) ──────────────────────────────────────────
      if (caps['import.module'] && !caps['import.from_module'] && !caps['import.relative_module']) {
        const dotted = caps['import.module']!.node.text
        const loc = nodeToLoc(caps['import.module']!.node)
        const result = classifyAbsolute(dotted, this.sourceRoots, ctx.repoRoot)
        addImport(dotted, false, loc, result)
        continue
      }

      // ── from foo import bar (absolute from-import) ─────────────────────
      if (caps['import.from_module'] && !caps['import.relative_module'] && !caps['import.wildcard_module']) {
        const mod = caps['import.from_module']!.node.text
        const loc = nodeToLoc(caps['import.from_module']!.node)
        const result = classifyAbsolute(mod, this.sourceRoots, ctx.repoRoot)
        const specifier = caps['import.from_name']
          ? `${mod}.${caps['import.from_name'].node.text}`
          : mod
        addImport(specifier, false, loc, result)
        continue
      }

      // ── from .foo import bar (relative from-import) ────────────────────
      if (caps['import.relative_module']) {
        const relText = caps['import.relative_module']!.node.text
        const loc = nodeToLoc(caps['import.relative_module']!.node)
        const { level, submodule: sub } = parseRelativeModule(relText)

        let resolvedSub = sub
        if (caps['import.relative_submodule']) {
          resolvedSub = caps['import.relative_submodule']!.node.text
        }

        const repoRelPath = resolveRelative(level, resolvedSub, fromFile, ctx.repoRoot)
        const specifier = relText + (resolvedSub && resolvedSub !== sub ? `.${resolvedSub}` : '')

        if (repoRelPath !== null) {
          addImport(specifier, false, loc, { kind: 'file', repoRelPath })
        } else {
          addImport(specifier, false, loc, { kind: 'unresolved' })
        }
        continue
      }

      // ── from foo import * (wildcard absolute) ──────────────────────────
      if (caps['import.wildcard_module']) {
        const mod = caps['import.wildcard_module']!.node.text
        const loc = nodeToLoc(caps['import.wildcard_module']!.node)
        const result = classifyAbsolute(mod, this.sourceRoots, ctx.repoRoot)
        addImport(mod, true, loc, result)
        continue
      }

      // ── from . import * (wildcard relative) ───────────────────────────
      if (caps['import.wildcard_rel_module']) {
        const relText = caps['import.wildcard_rel_module']!.node.text
        const loc = nodeToLoc(caps['import.wildcard_rel_module']!.node)
        const { level, submodule } = parseRelativeModule(relText)
        const repoRelPath = resolveRelative(level, submodule, fromFile, ctx.repoRoot)
        if (repoRelPath !== null) {
          addImport(relText, true, loc, { kind: 'file', repoRelPath })
        } else {
          addImport(relText, true, loc, { kind: 'unresolved' })
        }
        continue
      }
    }

    return { edges, imports }
  }

  private externalCache = new Map<string, GraphNode>()

  private ensureExternal(spec: string): GraphNode {
    const id = externalId(spec)
    if (!this.externalCache.has(id)) {
      this.externalCache.set(id, {
        id,
        kind: 'external',
        language: 'python',
        name: spec,
      })
    }
    return this.externalCache.get(id)!
  }
}

function nodeToLoc(node: { startPosition: { row: number; column: number } }): {
  line: number
  col: number
} {
  return { line: node.startPosition.row, col: node.startPosition.column }
}
