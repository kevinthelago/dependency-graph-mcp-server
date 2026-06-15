import type { LanguageAnalyzer, ProjectContext, AnalysisFragment } from '../types.js'
import type { GrammarHandle } from '../tree-sitter/index.js'
import { loadGrammar } from '../tree-sitter/index.js'
import type { Node, Edge } from '../../graph/model.js'
import { makeFileId, makeSymId, makeExtId } from '../../graph/node-id.js'
import { loadCargoConfig, type CargoConfig } from './cargo.js'
import { resolveModDecl, resolveUsePath } from './resolver.js'
import { extractSymbols, extractMods, extractUses } from './symbols.js'

const ANALYZER_VERSION = '1.0.0'

/**
 * Rust language analyzer.
 *
 * Implements LanguageAnalyzer per contracts/language-analyzer.md.
 * Consumes the tree-sitter scaffold from src/analyzers/tree-sitter/ (py-1).
 *
 * Supported:
 *   - Top-level items (fn, struct, enum, trait, type, const, static, macro_rules!)
 *   - `mod foo;` → foo.rs / foo/mod.rs file edges
 *   - Inline `mod foo { }` → module symbol
 *   - `use` paths: crate/super/self/abs resolved; external leaves from Cargo.toml
 *   - `pub use` re-exports; wildcard `use foo::*`
 *
 * Cargo workspaces: out of scope for v1.
 */
export class RustAnalyzer implements LanguageAnalyzer {
  readonly id = 'rust'
  readonly extensions = ['.rs']
  readonly version = ANALYZER_VERSION

  private grammar: GrammarHandle | null = null
  private cargo: CargoConfig | null = null
  private repoRoot = ''

  /**
   * @param grammarFactory - optional override for tests; defaults to loadGrammar('rust')
   */
  constructor(
    private readonly grammarFactory?: () => Promise<GrammarHandle>,
  ) {}

  async init(project: ProjectContext): Promise<void> {
    const factory = this.grammarFactory ?? (() => loadGrammar('rust'))
    this.grammar = await factory()
    this.repoRoot = project.repoRoot
    this.cargo = await loadCargoConfig(project.repoRoot)
  }

  async analyzeFile(filePath: string, text: string): Promise<AnalysisFragment> {
    const { grammar, cargo, repoRoot } = this
    if (grammar == null || cargo == null) {
      throw new Error('RustAnalyzer.init() must be called before analyzeFile()')
    }

    const tree = grammar.parse(text)
    const root = tree.rootNode

    // Normalize to repo-relative forward-slash path
    const repoRelPath = filePath.replace(/\\/g, '/')

    // --- File node ---
    const fileId = makeFileId(repoRelPath)
    const fileNode: Node = {
      id: fileId,
      kind: 'file',
      language: 'rust',
      name: repoRelPath,
    }

    // --- Symbol nodes from top-level items ---
    const extractedSymbols = extractSymbols(root)
    const symbolNodes: Node[] = extractedSymbols.map((s) => ({
      id: makeSymId(repoRelPath, s.name),
      kind: 'symbol' as const,
      language: 'rust' as const,
      name: s.name,
      symbolKind: s.kind,
      file: repoRelPath,
      loc: s.loc,
      exported: s.exported,
    }))

    // --- Mod items: declarations → file edges; inline → symbol nodes ---
    const mods = extractMods(root)
    const edges: Edge[] = []

    for (const m of mods) {
      if (!m.isDecl) {
        // Inline `mod foo { }` → symbol node of kind 'module'
        symbolNodes.push({
          id: makeSymId(repoRelPath, m.name),
          kind: 'symbol',
          language: 'rust',
          name: m.name,
          symbolKind: 'module',
          file: repoRelPath,
          loc: m.loc,
          exported: false,
        })
        continue
      }

      // `mod foo;` → file edge
      const targetPath = resolveModDecl(m.name, repoRelPath, repoRoot)
      if (targetPath != null) {
        edges.push({
          from: fileId,
          to: makeFileId(targetPath),
          kind: 'import',
          targetType: 'file',
          resolution: 'resolved',
          loc: m.loc,
        })
      } else {
        edges.push({
          from: fileId,
          to: makeFileId(`<unresolved>/${repoRelPath}::${m.name}`),
          kind: 'import',
          targetType: 'file',
          resolution: 'unresolved',
          loc: m.loc,
        })
      }
    }

    // --- Use declarations → import edges ---
    const uses = extractUses(root)
    const externalNodes = new Map<string, Node>()
    const imports: AnalysisFragment['imports'] = []

    for (const useDecl of uses) {
      for (const flat of useDecl.flat) {
        const resolved = resolveUsePath(flat, repoRelPath, repoRoot, cargo)

        if (resolved.targetFile != null) {
          const targetId = makeFileId(resolved.targetFile)
          edges.push({
            from: fileId,
            to: targetId,
            kind: 'import',
            targetType: 'file',
            ...(flat.wildcard ? { wildcard: true } : {}),
            resolution: 'resolved',
            loc: useDecl.loc,
          })
          imports.push({ targetId, resolution: 'resolved' })
        } else if (resolved.externalSpec != null) {
          const extId = makeExtId('rust', resolved.externalSpec)
          if (!externalNodes.has(extId)) {
            externalNodes.set(extId, {
              id: extId,
              kind: 'external',
              language: 'rust',
              name: resolved.externalSpec,
            })
          }
          edges.push({
            from: fileId,
            to: extId,
            kind: 'import',
            targetType: 'external',
            ...(flat.wildcard ? { wildcard: true } : {}),
            resolution: resolved.resolution,
            loc: useDecl.loc,
          })
          imports.push({ targetId: extId, resolution: resolved.resolution })
        } else {
          const pseudoId = makeFileId(`<unresolved>/${flat.segments.join('::')}`)
          edges.push({
            from: fileId,
            to: pseudoId,
            kind: 'import',
            targetType: 'file',
            resolution: 'unresolved',
            loc: useDecl.loc,
          })
          imports.push({ targetId: pseudoId, resolution: 'unresolved' })
        }
      }
    }

    // Merge external nodes into symbols (they're leaf graph nodes, not file symbols)
    const allSymbols = [...symbolNodes, ...externalNodes.values()]

    // Deterministic ordering per contract
    const sortedSymbols = allSymbols
      .slice()
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    const sortedEdges = edges
      .slice()
      .sort((a, b) =>
        a.from < b.from
          ? -1
          : a.from > b.from
            ? 1
            : a.to < b.to
              ? -1
              : a.to > b.to
                ? 1
                : 0,
      )
    const sortedImports = imports
      .slice()
      .sort((a, b) => (a.targetId < b.targetId ? -1 : a.targetId > b.targetId ? 1 : 0))

    return {
      file: fileNode,
      symbols: sortedSymbols,
      edges: sortedEdges,
      imports: sortedImports,
    }
  }

  async dispose(): Promise<void> {
    this.grammar = null
    this.cargo = null
  }
}

export default RustAnalyzer
