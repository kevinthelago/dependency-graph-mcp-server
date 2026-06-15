import { existsSync } from 'node:fs'
import path from 'node:path'
import type { CargoConfig } from './cargo.js'

export interface FlatUse {
  /** Full path segments, e.g. ["crate","utils","helper"] */
  segments: string[]
  alias: string | null
  wildcard: boolean
}

export interface ResolvedUse {
  /** repo-relative target file path (resolved), or full path (unresolved) */
  targetFile: string | null
  /** External crate spec, e.g. "serde::Deserialize" */
  externalSpec: string | null
  resolution: 'resolved' | 'unresolved'
  wildcard: boolean
}

/**
 * Resolve a `mod foo;` declaration to a repo-relative file path.
 * Checks `{dir}/foo.rs` then `{dir}/foo/mod.rs`.
 */
export function resolveModDecl(
  modName: string,
  fromFile: string,
  repoRoot: string,
): string | null {
  const dir = path.dirname(path.join(repoRoot, fromFile))

  const candidate1 = path.join(dir, `${modName}.rs`)
  if (existsSync(candidate1)) {
    return path.relative(repoRoot, candidate1).replace(/\\/g, '/')
  }

  const candidate2 = path.join(dir, modName, 'mod.rs')
  if (existsSync(candidate2)) {
    return path.relative(repoRoot, candidate2).replace(/\\/g, '/')
  }

  return null
}

/**
 * Resolve a flat use path to a target file or external spec.
 *
 * Rust resolution rules:
 *   crate::  → from crate root (src/lib.rs or src/main.rs)
 *   super::  → parent directory's module file
 *   self::   → current file's directory
 *   <name>:: → if in externalCrates → external; else try crate-root resolution
 */
export function resolveUsePath(
  flat: FlatUse,
  fromFile: string,
  repoRoot: string,
  cargo: CargoConfig,
): ResolvedUse {
  const { segments, wildcard } = flat

  if (segments.length === 0) {
    return { targetFile: null, externalSpec: null, resolution: 'unresolved', wildcard }
  }

  const first = segments[0] ?? ''

  if (first === 'crate') {
    return resolveFromBase(segments.slice(1), cargo.crateRoot, repoRoot, cargo, wildcard)
  }

  if (first === 'super') {
    const parentDir = path.dirname(path.dirname(path.join(repoRoot, fromFile)))
    const parentBase = path.relative(repoRoot, parentDir).replace(/\\/g, '/')
    return resolveFromBase(segments.slice(1), parentBase, repoRoot, cargo, wildcard, true)
  }

  if (first === 'self') {
    const selfDir = path.dirname(path.join(repoRoot, fromFile))
    const selfBase = path.relative(repoRoot, selfDir).replace(/\\/g, '/')
    return resolveFromBase(segments.slice(1), selfBase, repoRoot, cargo, wildcard, true)
  }

  // External crate (incl. std, serde, etc.)
  if (cargo.externalCrates.has(first)) {
    return {
      targetFile: null,
      externalSpec: segments.join('::'),
      resolution: 'resolved',
      wildcard,
    }
  }

  // Unknown first segment — treat as unresolved external
  return {
    targetFile: null,
    externalSpec: segments.join('::'),
    resolution: 'unresolved',
    wildcard,
  }
}

/**
 * Walk segments from a base directory, resolving each segment as a sub-module file.
 * The last segment may be a symbol name rather than a module — we try to resolve
 * all but the last as the file, then fall back to all segments.
 */
function resolveFromBase(
  segments: string[],
  base: string,
  repoRoot: string,
  cargo: CargoConfig,
  wildcard: boolean,
  isDir = false,
): ResolvedUse {
  if (segments.length === 0) {
    // Resolves to the base itself (e.g. `use crate;` is unusual but valid)
    const file = findModuleFile(base, repoRoot, isDir)
    return file != null
      ? { targetFile: file, externalSpec: null, resolution: 'resolved', wildcard }
      : { targetFile: null, externalSpec: null, resolution: 'unresolved', wildcard }
  }

  // Try treating all segments as module path
  const fullFile = resolveSegments(segments, base, repoRoot, isDir)
  if (fullFile != null) {
    return { targetFile: fullFile, externalSpec: null, resolution: 'resolved', wildcard }
  }

  // Last segment is likely a symbol — resolve parent segments as the module file
  if (segments.length > 1) {
    const parentFile = resolveSegments(segments.slice(0, -1), base, repoRoot, isDir)
    if (parentFile != null) {
      return { targetFile: parentFile, externalSpec: null, resolution: 'resolved', wildcard }
    }
  }

  // Unresolved — keep as string for the edge
  const spec = [crateRootToName(base, cargo), ...segments].join('::')
  return { targetFile: null, externalSpec: spec, resolution: 'unresolved', wildcard }
}

function resolveSegments(
  segments: string[],
  base: string,
  repoRoot: string,
  baseIsDir: boolean,
): string | null {
  // Start from the base directory
  let current = baseIsDir
    ? path.join(repoRoot, base)
    : path.dirname(path.join(repoRoot, base))

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg == null) break

    if (i === segments.length - 1) {
      // Final segment: try as file
      const f1 = path.join(current, `${seg}.rs`)
      if (existsSync(f1)) return path.relative(repoRoot, f1).replace(/\\/g, '/')
      const f2 = path.join(current, seg, 'mod.rs')
      if (existsSync(f2)) return path.relative(repoRoot, f2).replace(/\\/g, '/')
      return null
    } else {
      // Intermediate segment: must be a directory or mod file
      const asDir = path.join(current, seg)
      if (existsSync(asDir)) {
        current = asDir
      } else {
        // Could be a module in a single file; resolve path doesn't continue
        return null
      }
    }
  }
  return null
}

function findModuleFile(base: string, repoRoot: string, isDir: boolean): string | null {
  if (isDir) {
    const modFile = path.join(repoRoot, base, 'mod.rs')
    if (existsSync(modFile)) return path.relative(repoRoot, modFile).replace(/\\/g, '/')
    return null
  }
  const file = path.join(repoRoot, base)
  if (existsSync(file)) return base
  return null
}

function crateRootToName(crateRoot: string, cargo: CargoConfig): string {
  if (crateRoot === cargo.crateRoot) return cargo.crateName
  return cargo.crateName
}
