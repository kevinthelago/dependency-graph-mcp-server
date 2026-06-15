// ts-1: TypeScript Program/LanguageService host + tsconfig parsing

import * as ts from 'typescript';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { ProjectContext } from '../types.js';

export interface TsProjectState {
  languageService: ts.LanguageService;
  compilerOptions: ts.CompilerOptions;
  repoRoot: string;
  /** Update (or add) a file in the in-memory snapshot, incrementing its version. */
  updateFile(filePath: string, text: string): void;
  /** Returns the set of absolute paths currently tracked by the host. */
  fileNames(): string[];
}

// ---------------------------------------------------------------------------
// In-memory LanguageServiceHost
// ---------------------------------------------------------------------------

class InMemoryHost implements ts.LanguageServiceHost {
  private readonly snapshots = new Map<string, { text: string; version: number }>();
  private names: string[];

  constructor(
    private readonly root: string,
    private readonly options: ts.CompilerOptions,
    initialFiles: Map<string, string>,
  ) {
    for (const [p, text] of initialFiles) {
      this.snapshots.set(p, { text, version: 0 });
    }
    this.names = Array.from(initialFiles.keys());
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.options;
  }

  getScriptFileNames(): string[] {
    return this.names;
  }

  getScriptVersion(fileName: string): string {
    return String(this.snapshots.get(fileName)?.version ?? 0);
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const entry = this.snapshots.get(fileName);
    if (entry) return ts.ScriptSnapshot.fromString(entry.text);
    // fall back to disk for lib files not in the project
    const text = ts.sys.readFile(fileName);
    if (text !== undefined) return ts.ScriptSnapshot.fromString(text);
    return undefined;
  }

  getCurrentDirectory(): string {
    return this.root;
  }

  getDefaultLibFileName(opts: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(opts);
  }

  fileExists(fileName: string): boolean {
    return this.snapshots.has(fileName) || ts.sys.fileExists(fileName);
  }

  readFile(fileName: string, encoding?: string): string | undefined {
    return this.snapshots.get(fileName)?.text ?? ts.sys.readFile(fileName, encoding);
  }

  readDirectory(
    p: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[] {
    return ts.sys.readDirectory(p, extensions, exclude, include, depth);
  }

  directoryExists(dirName: string): boolean {
    return ts.sys.directoryExists(dirName);
  }

  getDirectories(p: string): string[] {
    return ts.sys.getDirectories(p);
  }

  realpath(p: string): string {
    return ts.sys.realpath?.(p) ?? p;
  }

  getNewLine(): string {
    return ts.sys.newLine;
  }

  useCaseSensitiveFileNames(): boolean {
    return ts.sys.useCaseSensitiveFileNames;
  }

  // ---------------------------------------------------------------------------

  updateFile(fileName: string, text: string): void {
    const entry = this.snapshots.get(fileName);
    if (entry) {
      entry.text = text;
      entry.version++;
    } else {
      this.snapshots.set(fileName, { text, version: 0 });
      if (!this.names.includes(fileName)) {
        this.names.push(fileName);
      }
    }
  }

  allFileNames(): string[] {
    return this.names;
  }
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

/**
 * Build a TsProjectState for the given ProjectContext.
 * Parses tsconfig (or falls back to defaults), reads all project files into
 * the in-memory snapshot host, and creates a LanguageService.
 */
export function createTsProject(project: ProjectContext): TsProjectState {
  const { repoRoot, config } = project;

  const configPath =
    (config['tsconfig'] as string | undefined) ??
    ts.findConfigFile(repoRoot, ts.sys.fileExists, 'tsconfig.json');

  let compilerOptions: ts.CompilerOptions;
  let fileNames: string[];

  if (configPath) {
    const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readResult.error) {
      compilerOptions = defaultOptions();
      fileNames = scanProjectFiles(repoRoot);
    } else {
      const parsed = ts.parseJsonConfigFileContent(
        readResult.config,
        ts.sys,
        path.dirname(configPath),
      );
      compilerOptions = parsed.options;
      fileNames = parsed.fileNames;
    }
  } else {
    compilerOptions = defaultOptions();
    fileNames = scanProjectFiles(repoRoot);
  }

  // Force analysis-only options
  compilerOptions = {
    ...compilerOptions,
    noEmit: true,
    skipLibCheck: true,
  };

  const initialFiles = new Map<string, string>();
  for (const f of fileNames) {
    const text = ts.sys.readFile(f);
    if (text !== undefined) initialFiles.set(f, text);
  }

  const host = new InMemoryHost(repoRoot, compilerOptions, initialFiles);
  const registry = ts.createDocumentRegistry();
  const languageService = ts.createLanguageService(host, registry);

  return {
    languageService,
    compilerOptions,
    repoRoot,
    updateFile: (p, text) => host.updateFile(p, text),
    fileNames: () => host.allFileNames(),
  };
}

function defaultOptions(): ts.CompilerOptions {
  return {
    ...ts.getDefaultCompilerOptions(),
    allowJs: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
  };
}

function scanProjectFiles(root: string): string[] {
  const result: string[] = [];
  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|mts|cts)$/.test(e.name) && !e.name.endsWith('.d.ts')) {
        result.push(full);
      }
    }
  }
  walk(root);
  return result;
}
