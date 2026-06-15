/**
 * Python best-effort reference edges.
 *
 * Emits `kind:"reference"` edges from the importing file to symbol nodes in
 * imported files when a name from `from X import Y` is used in an identifier
 * position in the current file.
 *
 * LIMITATION (documented): no type inference, no dynamic / attribute /
 * runtime resolution. Only static name resolution against module-scope
 * import bindings and top-level declarations is performed. Names that are
 * reassigned, used via `getattr`, or accessed through computed strings are
 * not tracked.
 */

import type { Tree, SyntaxNode } from 'web-tree-sitter'
import type { Edge, ImportRef } from '../types.js'
import { fileId, symbolId } from '../../graph/node-id.js'
import type { QueryRunner } from '../tree-sitter/index.js'

/** A binding created by `from X import Y [as Z]`. */
interface Binding {
  /** The local name bound in the current file (Y, or Z if aliased). */
  localName: string
  /** The canonical name in the source module (Y). */
  exportedName: string
  /** Repo-relative path of the source module. */
  sourceFile: string
}

/** A binding created by `import X [as Y]`. */
interface ModuleBinding {
  localName: string
  /** Repo-relative path of the bound module. */
  sourceFile: string
}

const IDENTIFIER_QUERY = `(identifier) @id`

/**
 * Build best-effort reference edges for a file.
 *
 * @param tree       Parsed tree for the current file.
 * @param qr         QueryRunner instance (reuse from the analyzer).
 * @param imports    Resolved ImportRefs from py-2 analysis.
 * @param repoRelPath  Repo-relative path of the current file.
 * @param symbolsByFile  Map from repo-relative path → symbol names in that file.
 *                       Needed to confirm the target symbol actually exists.
 *                       If absent, we emit the reference optimistically.
 */
export function buildReferenceEdges(
  tree: Tree,
  qr: QueryRunner,
  imports: ImportRef[],
  repoRelPath: string,
  symbolsByFile?: Map<string, string[]>,
): Edge[] {
  // Build binding tables from resolved imports
  const nameBindings = new Map<string, Binding>()
  const moduleBindings = new Map<string, ModuleBinding>()

  // We need to reconstruct bindings from ImportRefs.
  // ImportRefs carry `specifier` which encodes the information:
  //   - `from X import Y`  → specifier = "X.Y"
  //   - `import X`         → specifier = "X"
  for (const imp of imports) {
    if (imp.isUnresolved || imp.isExternal || !imp.resolvedPath || imp.wildcard) {
      continue
    }

    const dot = imp.specifier.lastIndexOf('.')
    if (dot < 0) {
      // `import X` — bind module name to module file
      const localName = imp.specifier.split('.').pop() ?? imp.specifier
      moduleBindings.set(localName, {
        localName,
        sourceFile: imp.resolvedPath,
      })
    } else {
      // `from X import Y` — bind Y to symbol Y in X's file
      const exportedName = imp.specifier.slice(dot + 1)
      // For aliased imports we don't have the alias in ImportRef — we use
      // the exported name as the local name. This is a known limitation:
      // aliased names (`from X import Y as Z`) are not tracked here.
      nameBindings.set(exportedName, {
        localName: exportedName,
        exportedName,
        sourceFile: imp.resolvedPath,
      })
    }
  }

  if (nameBindings.size === 0 && moduleBindings.size === 0) {
    return []
  }

  // Collect all identifier usages in the file
  const captures = qr.captures(IDENTIFIER_QUERY, tree)
  const seen = new Set<string>()
  const edges: Edge[] = []

  for (const cap of captures) {
    const name = cap.node.text

    // Skip identifiers that are themselves definitions (they appear in the
    // query as definition.* captures — but since we're using a separate flat
    // identifier query, filter by position: if the parent is a definition node,
    // skip it).
    if (isDefinitionPosition(cap.node)) continue

    const loc = {
      line: cap.node.startPosition.row,
      col: cap.node.startPosition.column,
    }

    // Check name bindings (from X import Y)
    const binding = nameBindings.get(name)
    if (binding) {
      const targetId = symbolId(binding.sourceFile, binding.exportedName, 0)
      const dedupeKey = `ref:${targetId}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        // Verify the symbol exists if we have the map
        const symbolsInFile = symbolsByFile?.get(binding.sourceFile)
        const targetType = symbolsInFile
          ? symbolsInFile.includes(binding.exportedName)
            ? 'symbol'
            : 'file'
          : 'symbol'
        edges.push({
          from: fileId(repoRelPath),
          to: targetId,
          kind: 'reference',
          targetType,
          resolution: 'resolved',
          loc,
        })
      }
      continue
    }

    // Check module bindings (import X — usage like X.something)
    const modBinding = moduleBindings.get(name)
    if (modBinding) {
      const targetId = fileId(modBinding.sourceFile)
      const dedupeKey = `ref:${targetId}`
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey)
        edges.push({
          from: fileId(repoRelPath),
          to: targetId,
          kind: 'reference',
          targetType: 'file',
          resolution: 'resolved',
          loc,
        })
      }
    }
  }

  return edges
}

/** Return true if this identifier is in a definition (name) position. */
function isDefinitionPosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  const parentType = parent.type
  // These node types have the identifier as their `name` child
  const defTypes = new Set([
    'function_definition',
    'class_definition',
    'decorated_definition',
    'import_statement',
    'import_from_statement',
    'aliased_import',
    'dotted_name',  // part of import paths
    'relative_import',
  ])
  if (defTypes.has(parentType)) return true

  // Assignment LHS at module level
  if (parentType === 'assignment' || parentType === 'annotated_assignment') {
    const lhs = parent.child(0)
    if (lhs?.id === node.id) return true
  }

  return false
}
