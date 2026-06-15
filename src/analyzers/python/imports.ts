/**
 * Python import resolution.
 *
 * Resolves import specifiers to one of:
 *   - A repo-relative file path (project file)
 *   - An external specifier  (stdlib / third-party → external leaf)
 *   - Unresolved             (when the module can't be found)
 *
 * Supports:
 *   - Absolute imports: `import foo`, `import foo.bar`, `from foo import x`
 *   - Relative imports: `from . import x`, `from .foo import x`, `from .. import x`
 *   - `__init__.py` packages
 *   - Wildcard imports: `from foo import *`
 *   - Configurable source roots (also read from pyproject.toml / setup.cfg)
 */

import { existsSync } from 'fs'
import { join, relative, dirname, resolve } from 'path'

type ResolveResult =
  | { kind: 'file'; repoRelPath: string }
  | { kind: 'external'; spec: string }

/** Dotted module path → candidate file paths under a source root. */
function moduleToPaths(sourceRoot: string, dotted: string): string[] {
  const parts = dotted.split('.')
  const base = join(sourceRoot, ...parts)
  return [
    `${base}.py`,        // foo/bar.py
    join(base, '__init__.py'), // foo/bar/__init__.py (package)
  ]
}

/**
 * Resolve an absolute module specifier against the source roots.
 * Returns the repo-relative path of the first matching file, or null.
 */
export function resolveAbsolute(
  dotted: string,
  sourceRoots: string[],
  repoRoot: string,
): string | null {
  for (const root of sourceRoots) {
    for (const abs of moduleToPaths(root, dotted)) {
      if (existsSync(abs)) {
        return relative(repoRoot, abs).replace(/\\/g, '/')
      }
    }
  }
  return null
}

/**
 * Resolve a relative import.
 *
 * @param level    Number of leading dots (1 = current package, 2 = parent, …)
 * @param submodule  Optional dotted submodule after the dots (e.g. "foo.bar")
 * @param fromFile  Repo-relative path of the file doing the import
 * @param repoRoot  Absolute repo root
 */
export function resolveRelative(
  level: number,
  submodule: string | null,
  fromFile: string,
  repoRoot: string,
): string | null {
  // Start from the directory containing the importing file
  const absFile = resolve(repoRoot, fromFile)
  let base = dirname(absFile)

  // Walk up `level - 1` directories (level=1 means current package dir)
  for (let i = 1; i < level; i++) {
    base = dirname(base)
  }

  if (!submodule) {
    // `from . import x` — the package's __init__.py
    const init = join(base, '__init__.py')
    if (existsSync(init)) {
      return relative(repoRoot, init).replace(/\\/g, '/')
    }
    return null
  }

  // `from .foo.bar import x` → resolve foo/bar.py or foo/bar/__init__.py
  for (const abs of moduleToPaths(base, submodule)) {
    if (existsSync(abs)) {
      return relative(repoRoot, abs).replace(/\\/g, '/')
    }
  }
  return null
}

/** Parse a relative import prefix into level + optional submodule. */
export function parseRelativeModule(rawModuleText: string): {
  level: number
  submodule: string | null
} {
  // rawModuleText comes from the tree-sitter `relative_import` node text,
  // e.g. ".", "..", ".foo", "..bar"
  let level = 0
  let rest = rawModuleText
  while (rest.startsWith('.')) {
    level++
    rest = rest.slice(1)
  }
  return { level, submodule: rest.length > 0 ? rest : null }
}

/**
 * Determine if a top-level module name is almost certainly external
 * (stdlib or third-party). Heuristic: if we can't find it in any source root,
 * it's external. We don't maintain a stdlib list — the absence of a project
 * file is sufficient signal.
 */
export function classifyAbsolute(
  dotted: string,
  sourceRoots: string[],
  repoRoot: string,
): ResolveResult {
  const resolved = resolveAbsolute(dotted, sourceRoots, repoRoot)
  if (resolved !== null) {
    return { kind: 'file', repoRelPath: resolved }
  }
  // Treat as external (stdlib / third-party)
  return { kind: 'external', spec: dotted.split('.')[0] ?? dotted }
}
