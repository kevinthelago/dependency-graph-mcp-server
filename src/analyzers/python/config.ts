/**
 * Source-root discovery for Python projects.
 *
 * Priority (highest first):
 *   1. Explicit `sourceRoots` in ProjectContext.config.
 *   2. pyproject.toml  [tool.setuptools.packages.find] where = [...]
 *      or              [tool.setuptools.package-dir]
 *   3. setup.cfg       [options] package_dir
 *   4. Fallback: repo root.
 *
 * All paths returned are absolute.
 */

import { readFileSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { parse as parseToml } from 'smol-toml'

export function resolveSourceRoots(
  repoRoot: string,
  config: Record<string, unknown>,
): string[] {
  // 1. Explicit config override
  const explicit = config['sourceRoots']
  if (Array.isArray(explicit) && explicit.length > 0) {
    return explicit
      .filter((r): r is string => typeof r === 'string')
      .map((r) => resolve(repoRoot, r))
  }

  // 2. pyproject.toml
  const pyproject = join(repoRoot, 'pyproject.toml')
  if (existsSync(pyproject)) {
    const roots = readPyprojectRoots(repoRoot, pyproject)
    if (roots) return roots
  }

  // 3. setup.cfg
  const setupCfg = join(repoRoot, 'setup.cfg')
  if (existsSync(setupCfg)) {
    const roots = readSetupCfgRoots(repoRoot, setupCfg)
    if (roots) return roots
  }

  // 4. Fallback: repo root itself
  return [repoRoot]
}

function readPyprojectRoots(repoRoot: string, path: string): string[] | null {
  try {
    const raw = readFileSync(path, 'utf8')
    const doc = parseToml(raw) as Record<string, unknown>
    const tool = doc['tool'] as Record<string, unknown> | undefined
    if (!tool) return null

    const setuptools = tool['setuptools'] as Record<string, unknown> | undefined
    if (!setuptools) return null

    // [tool.setuptools.packages.find] where = ["src"]
    const find = (setuptools['packages'] as Record<string, unknown> | undefined)
      ?.['find'] as Record<string, unknown> | undefined
    const where = find?.['where']
    if (Array.isArray(where) && where.length > 0) {
      return (where as unknown[])
        .filter((w): w is string => typeof w === 'string')
        .map((w) => resolve(repoRoot, w))
    }

    // [tool.setuptools.package-dir] "" = "src"
    const pkgDir = setuptools['package-dir'] as Record<string, string> | undefined
    if (pkgDir) {
      const root = pkgDir[''] ?? pkgDir['*']
      if (typeof root === 'string') return [resolve(repoRoot, root)]
    }

    return null
  } catch {
    return null
  }
}

function readSetupCfgRoots(repoRoot: string, path: string): string[] | null {
  try {
    const raw = readFileSync(path, 'utf8')
    // Minimal ini parser — look for [options] section and package_dir key
    const lines = raw.split(/\r?\n/)
    let inOptions = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('[')) {
        inOptions = trimmed === '[options]'
        continue
      }
      if (!inOptions) continue
      const match = /^package_dir\s*=\s*(.+)/.exec(trimmed)
      if (match) {
        // e.g. "=src" or "* = src" or "= src"
        const val = (match[1] ?? '').trim()
        // Handle both "=src" and "=   src"
        const eqIdx = val.indexOf('=')
        const dir = eqIdx >= 0 ? val.slice(eqIdx + 1).trim() : val
        if (dir) return [resolve(repoRoot, dir)]
      }
    }
    return null
  } catch {
    return null
  }
}
