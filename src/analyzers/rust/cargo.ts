import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from 'smol-toml'

export interface CargoConfig {
  /** Crate name from [package] */
  crateName: string
  /** Primary crate entry point (lib.rs or main.rs), repo-relative */
  crateRoot: string
  /** Additional binary entry points from [[bin]], repo-relative */
  additionalRoots: string[]
  /** All external crate names from [dependencies] + [dev-dependencies] + [build-dependencies] */
  externalCrates: Set<string>
}

interface TomlPackage {
  name?: string
}

interface TomlLib {
  path?: string
}

interface TomlBin {
  name?: string
  path?: string
}

interface TomlManifest {
  package?: TomlPackage
  lib?: TomlLib
  bin?: TomlBin[]
  dependencies?: Record<string, unknown>
  'dev-dependencies'?: Record<string, unknown>
  'build-dependencies'?: Record<string, unknown>
}

const STDLIB_CRATES = new Set(['std', 'core', 'alloc', 'proc_macro', 'test'])

/** Locate and parse the nearest Cargo.toml above or at `repoRoot`. */
export async function loadCargoConfig(repoRoot: string): Promise<CargoConfig> {
  const cargoPath = path.join(repoRoot, 'Cargo.toml')

  if (!existsSync(cargoPath)) {
    return defaultConfig(repoRoot)
  }

  const raw = await readFile(cargoPath, 'utf-8')
  const manifest = parseToml(raw) as TomlManifest

  const crateName = manifest.package?.name ?? path.basename(repoRoot)

  // Determine library root
  const libRoot = resolveLibRoot(manifest, repoRoot)

  // Determine binary roots
  const binRoots = resolveBinRoots(manifest, repoRoot, libRoot)

  const crateRoot = libRoot ?? binRoots[0] ?? path.join('src', 'main.rs')
  const additionalRoots = libRoot != null ? binRoots : binRoots.slice(1)

  const externalCrates = collectExternalCrates(manifest)

  return { crateName, crateRoot, additionalRoots, externalCrates }
}

function resolveLibRoot(manifest: TomlManifest, repoRoot: string): string | undefined {
  if (manifest.lib?.path != null) {
    return normalizeRepoRelative(manifest.lib.path, repoRoot)
  }
  const defaultLib = path.join(repoRoot, 'src', 'lib.rs')
  if (existsSync(defaultLib)) {
    return path.join('src', 'lib.rs')
  }
  return undefined
}

function resolveBinRoots(
  manifest: TomlManifest,
  repoRoot: string,
  libRoot: string | undefined,
): string[] {
  if (manifest.bin != null && manifest.bin.length > 0) {
    return manifest.bin.map((b) => {
      if (b.path != null) return normalizeRepoRelative(b.path, repoRoot)
      if (b.name != null) return path.join('src', 'bin', `${b.name}.rs`)
      return path.join('src', 'main.rs')
    })
  }
  // Default: src/main.rs if it exists and there's no lib
  if (libRoot == null) {
    const defaultMain = path.join(repoRoot, 'src', 'main.rs')
    if (existsSync(defaultMain)) return [path.join('src', 'main.rs')]
  }
  return []
}

function collectExternalCrates(manifest: TomlManifest): Set<string> {
  const names = new Set<string>(STDLIB_CRATES)
  for (const section of [
    manifest.dependencies,
    manifest['dev-dependencies'],
    manifest['build-dependencies'],
  ]) {
    if (section != null) {
      for (const name of Object.keys(section)) {
        names.add(name)
        // Normalize hyphenated crate names (Cargo normalizes - to _)
        names.add(name.replace(/-/g, '_'))
      }
    }
  }
  return names
}

function normalizeRepoRelative(p: string, repoRoot: string): string {
  // If already relative, return as-is with forward slashes
  if (!path.isAbsolute(p)) return p.replace(/\\/g, '/')
  return path.relative(repoRoot, p).replace(/\\/g, '/')
}

function defaultConfig(repoRoot: string): CargoConfig {
  const hasLib = existsSync(path.join(repoRoot, 'src', 'lib.rs'))
  const crateRoot = hasLib ? path.join('src', 'lib.rs') : path.join('src', 'main.rs')
  return {
    crateName: path.basename(repoRoot),
    crateRoot: crateRoot.replace(/\\/g, '/'),
    additionalRoots: [],
    externalCrates: new Set(STDLIB_CRATES),
  }
}
