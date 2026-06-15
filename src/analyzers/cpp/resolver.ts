/**
 * Include resolver for C/C++ — issue #57 (cpp-1).
 *
 * Resolution order:
 *   1. compile_commands.json -I flags (project root or build/ sub-dir)
 *   2. Light CMake fallback (include_directories / target_include_directories)
 *   3. Configured dirs from ProjectContext.configuredIncludeDirs
 *   4. Convention fallback: <root>/include, <root>/src, <root>/inc
 *
 * Quoted includes search relative to the including file first.
 * Anything that resolves outside the project root is treated as external.
 *
 * This resolver is consumed by the Obj-C analyzer (objc-1, issue #61).
 * Reshape the public interface only after leaving a bsc-note.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname, join, isAbsolute, relative } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface ResolvedInclude {
  /** Absolute path when the header is found inside the project; null otherwise. */
  resolvedPath: string | null;
  /** True when the include maps to a system / out-of-project header. */
  isExternal: boolean;
}

export interface IncludeResolverOptions {
  projectRoot: string;
  includeDirs?: string[];
  defines?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IncludeResolver
// ─────────────────────────────────────────────────────────────────────────────

export class IncludeResolver {
  private readonly projectRoot: string;
  private readonly includeDirs: readonly string[];
  private readonly _defines: Readonly<Record<string, string>>;

  constructor(opts: IncludeResolverOptions) {
    this.projectRoot = opts.projectRoot;
    this.includeDirs = opts.includeDirs ?? [];
    this._defines = opts.defines ?? {};
  }

  get defines(): Readonly<Record<string, string>> {
    return this._defines;
  }

  /**
   * Resolve an include path to an absolute filesystem path.
   *
   * @param includePath  The path token from the directive, e.g. "util.h" or "sys/types.h".
   * @param fromFile     Absolute path of the file containing the #include.
   * @param isQuoted     True for `"..."` includes; false for `<...>`.
   */
  resolve(includePath: string, fromFile: string, isQuoted: boolean): ResolvedInclude {
    const searchDirs: string[] = [];

    // Quoted includes: search relative to the including file first.
    if (isQuoted) {
      searchDirs.push(dirname(fromFile));
    }

    searchDirs.push(...this.includeDirs);

    for (const dir of searchDirs) {
      const candidate = resolve(dir, includePath);
      if (existsSync(candidate) && !isDirectory(candidate)) {
        const rel = relative(this.projectRoot, candidate);
        if (!rel.startsWith('..') && !isAbsolute(rel)) {
          return { resolvedPath: candidate, isExternal: false };
        }
        // File exists but is outside the project root → external.
        return { resolvedPath: null, isExternal: true };
      }
    }

    // Not found in any search dir → external / system header.
    return { resolvedPath: null, isExternal: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory: buildResolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an IncludeResolver for the given project context, trying (in order):
 *   1. compile_commands.json
 *   2. CMakeLists.txt light parse
 *   3. ctx.configuredIncludeDirs
 *   4. Convention dirs
 */
export function buildResolver(
  ctx: { projectRoot: string; configuredIncludeDirs?: string[] },
  filePath?: string,
): IncludeResolver {
  const { projectRoot, configuredIncludeDirs = [] } = ctx;
  let includeDirs: string[] = [...configuredIncludeDirs];
  let defines: Record<string, string> = {};

  // 1. compile_commands.json
  const ccResult = tryCompileCommands(projectRoot, filePath);
  if (ccResult) {
    includeDirs = [...ccResult.includeDirs, ...includeDirs];
    defines = { ...ccResult.defines, ...defines };
  }

  // 2. CMake fallback (only if no compile_commands dirs discovered)
  if (ccResult === null) {
    const cmakeDirs = parseCMakeIncludeDirs(projectRoot);
    includeDirs = [...cmakeDirs, ...includeDirs];
  }

  // 3. Convention dirs (only if still empty)
  if (includeDirs.length === 0) {
    for (const name of ['include', 'src', 'inc']) {
      const candidate = join(projectRoot, name);
      if (existsSync(candidate) && isDirectory(candidate)) {
        includeDirs.push(candidate);
      }
    }
  }

  return new IncludeResolver({ projectRoot, includeDirs, defines });
}

// ─────────────────────────────────────────────────────────────────────────────
// compile_commands.json
// ─────────────────────────────────────────────────────────────────────────────

interface CompileCommand {
  file: string;
  directory: string;
  command?: string;
  arguments?: string[];
}

interface ParsedFlags {
  includeDirs: string[];
  defines: Record<string, string>;
}

function tryCompileCommands(projectRoot: string, filePath?: string): ParsedFlags | null {
  const candidates = [
    join(projectRoot, 'compile_commands.json'),
    join(projectRoot, 'build', 'compile_commands.json'),
  ];

  for (const ccPath of candidates) {
    if (!existsSync(ccPath)) continue;
    try {
      const commands = JSON.parse(readFileSync(ccPath, 'utf-8')) as CompileCommand[];
      if (!Array.isArray(commands) || commands.length === 0) continue;

      // Prefer the entry that matches our file; fall back to the first entry.
      const entry = filePath
        ? commands.find((c) => {
            const absFile = isAbsolute(c.file)
              ? c.file
              : resolve(c.directory, c.file);
            return absFile === filePath || c.file === filePath;
          }) ?? commands[0]
        : commands[0];

      if (!entry) continue;

      const args = entry.arguments ?? shellSplit(entry.command ?? '');
      return parseCompileFlags(args, entry.directory);
    } catch {
      // Malformed JSON — try the next candidate.
    }
  }
  return null;
}

function parseCompileFlags(args: string[], directory: string): ParsedFlags {
  const includeDirs: string[] = [];
  const defines: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg.startsWith('-I')) {
      const dir = arg.length > 2 ? arg.slice(2) : (args[++i] ?? '');
      if (dir) {
        includeDirs.push(isAbsolute(dir) ? dir : resolve(directory, dir));
      }
    } else if (arg === '-isystem' || arg === '-isysroot') {
      const dir = args[++i] ?? '';
      if (dir) {
        includeDirs.push(isAbsolute(dir) ? dir : resolve(directory, dir));
      }
    } else if (arg.startsWith('-D')) {
      const def = arg.length > 2 ? arg.slice(2) : (args[++i] ?? '');
      if (def) {
        const eq = def.indexOf('=');
        if (eq >= 0) {
          defines[def.slice(0, eq)] = def.slice(eq + 1);
        } else {
          defines[def] = '1';
        }
      }
    }
  }

  return { includeDirs, defines };
}

/** Minimal shell-split that handles single and double quoting. */
function shellSplit(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const ch of command) {
    if ((ch === '"' || ch === "'") && quote === null) {
      quote = ch;
    } else if (ch === quote) {
      quote = null;
    } else if (ch === ' ' && quote === null) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

// ─────────────────────────────────────────────────────────────────────────────
// CMake light fallback
// ─────────────────────────────────────────────────────────────────────────────

function parseCMakeIncludeDirs(projectRoot: string): string[] {
  const cmakePath = join(projectRoot, 'CMakeLists.txt');
  if (!existsSync(cmakePath)) return [];

  try {
    const src = readFileSync(cmakePath, 'utf-8');
    const dirs: string[] = [];

    // Match include_directories(...)
    const plainRe = /include_directories\s*\(([^)]+)\)/gi;
    // Match target_include_directories(target [PUBLIC|PRIVATE|INTERFACE] paths...)
    const targetRe = /target_include_directories\s*\(\s*\S+\s+(?:PUBLIC|PRIVATE|INTERFACE)\s+([^)]+)\)/gi;

    for (const re of [plainRe, targetRe]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const tokens = m[1]!.trim().split(/\s+/);
        for (const tok of tokens) {
          const cleaned = tok.replace(/"/g, '').trim();
          // Skip CMake keywords and generator expressions
          if (!cleaned || /^[A-Z_]+$/.test(cleaned) || cleaned.startsWith('$<')) continue;
          const dir = isAbsolute(cleaned) ? cleaned : join(projectRoot, cleaned);
          if (existsSync(dir) && isDirectory(dir)) {
            dirs.push(dir);
          }
        }
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
