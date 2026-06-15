import type { TSNode } from '../tree-sitter/index.js'
import type { SymbolKind, Loc } from '../../graph/model.js'
import type { FlatUse } from './resolver.js'

export interface ExtractedSymbol {
  name: string
  kind: SymbolKind
  exported: boolean
  loc: Loc
}

export interface ExtractedMod {
  name: string
  isDecl: boolean   // true = `mod foo;`, false = inline `mod foo { ... }`
  loc: Loc
}

export interface ExtractedUse {
  flat: FlatUse[]
  loc: Loc
}

const ITEM_SYMBOL_KINDS: Record<string, SymbolKind> = {
  function_item: 'function',
  struct_item: 'struct',
  enum_item: 'enum',
  trait_item: 'trait',
  type_item: 'type',
  const_item: 'variable',
  static_item: 'variable',
  macro_definition: 'macro',
}

/**
 * Extract top-level symbols (excluding mod items and use declarations).
 * v1: top-level only, no class members.
 */
export function extractSymbols(root: TSNode): ExtractedSymbol[] {
  const results: ExtractedSymbol[] = []
  const seen = new Map<string, number>()

  for (const child of root.namedChildren) {
    const kind = ITEM_SYMBOL_KINDS[child.type]
    if (kind == null) continue

    const name = getItemName(child)
    if (name == null) continue

    // Collision-suffix for symbols with same name (deterministic)
    const count = seen.get(name) ?? 0
    seen.set(name, count + 1)

    results.push({
      name: count === 0 ? name : `${name}~${count}`,
      kind,
      exported: hasVisibility(child),
      loc: { line: child.startPosition.row + 1, col: child.startPosition.column },
    })
  }

  return results
}

/** Extract `mod foo;` and inline `mod foo { ... }` declarations. */
export function extractMods(root: TSNode): ExtractedMod[] {
  const results: ExtractedMod[] = []

  for (const child of root.namedChildren) {
    if (child.type !== 'mod_item') continue

    const name = child.childForFieldName('name')?.text
    if (name == null) continue

    const hasBody = child.childForFieldName('body') != null

    results.push({
      name,
      isDecl: !hasBody,
      loc: { line: child.startPosition.row + 1, col: child.startPosition.column },
    })
  }

  return results
}

/** Extract and flatten all `use` declarations at the top level. */
export function extractUses(root: TSNode): ExtractedUse[] {
  const results: ExtractedUse[] = []

  for (const child of root.namedChildren) {
    if (child.type !== 'use_declaration') continue

    const arg = child.childForFieldName('argument')
    if (arg == null) continue

    const flat = flattenUseArg(arg, [])
    results.push({
      flat,
      loc: { line: child.startPosition.row + 1, col: child.startPosition.column },
    })
  }

  return results
}

/** Extract inline `pub use` re-exports. */
export function extractReexports(root: TSNode): ExtractedUse[] {
  const results: ExtractedUse[] = []

  for (const child of root.namedChildren) {
    if (child.type !== 'use_declaration') continue
    if (!hasVisibility(child)) continue

    const arg = child.childForFieldName('argument')
    if (arg == null) continue

    const flat = flattenUseArg(arg, [])
    results.push({
      flat,
      loc: { line: child.startPosition.row + 1, col: child.startPosition.column },
    })
  }

  return results
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getItemName(node: TSNode): string | null {
  return node.childForFieldName('name')?.text ?? null
}

function hasVisibility(node: TSNode): boolean {
  return node.children.some((c) => c.type === 'visibility_modifier')
}

/**
 * Flatten a use argument node into a list of FlatUse entries.
 * Handles all tree-sitter-rust use_clause variants.
 */
function flattenUseArg(node: TSNode, prefix: string[]): FlatUse[] {
  switch (node.type) {
    case 'identifier':
    case 'self':
    case 'super':
    case 'crate':
      return [{ segments: [...prefix, node.text], alias: null, wildcard: false }]

    case 'scoped_identifier': {
      const pathNode = node.childForFieldName('path')
      const nameNode = node.childForFieldName('name')
      const pathSegs = pathNode != null ? nodeToSegments(pathNode) : []
      if (nameNode == null) return []
      return flattenUseArg(nameNode, [...prefix, ...pathSegs])
    }

    case 'scoped_use_list': {
      const pathNode = node.childForFieldName('path')
      const listNode = node.childForFieldName('list')
      const pathSegs = pathNode != null ? nodeToSegments(pathNode) : []
      if (listNode == null) return []
      return flattenUseArg(listNode, [...prefix, ...pathSegs])
    }

    case 'use_list': {
      const out: FlatUse[] = []
      for (const child of node.namedChildren) {
        out.push(...flattenUseArg(child, prefix))
      }
      return out
    }

    case 'use_as_clause': {
      const pathNode = node.childForFieldName('path')
      const aliasNode = node.childForFieldName('alias')
      if (pathNode == null) return []
      const alias = aliasNode?.text ?? null
      return flattenUseArg(pathNode, prefix).map((f) => ({ ...f, alias }))
    }

    case 'use_wildcard': {
      // tree-sitter-rust: use_wildcard has no named 'path' field; use namedChildren[0]
      const pathNode = node.namedChildren[0] ?? null
      const pathSegs = pathNode != null ? nodeToSegments(pathNode) : []
      return [{ segments: [...prefix, ...pathSegs], alias: null, wildcard: true }]
    }

    default:
      return []
  }
}

/** Convert a scoped_identifier / identifier node to a flat string[] of segments. */
function nodeToSegments(node: TSNode): string[] {
  if (node.type === 'identifier' || node.type === 'self' || node.type === 'super' || node.type === 'crate') {
    return [node.text]
  }
  if (node.type === 'scoped_identifier') {
    const p = node.childForFieldName('path')
    const n = node.childForFieldName('name')
    return [...(p != null ? nodeToSegments(p) : []), ...(n != null ? [n.text] : [])]
  }
  return [node.text]
}
