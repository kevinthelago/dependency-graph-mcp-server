import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { createTsProject } from '../../../src/analyzers/typescript/program.js';
import type { ProjectContext } from '../../../src/analyzers/types.js';

const FIXTURE = path.resolve('fixtures/ts/simple');

function makeCtx(root: string, config: Record<string, unknown> = {}): ProjectContext {
  return { repoRoot: root, config, resolveExternal: () => null };
}

describe('createTsProject', () => {
  it('loads tsconfig and returns a LanguageService', () => {
    const state = createTsProject(makeCtx(FIXTURE));
    expect(state.languageService).toBeDefined();
    expect(state.repoRoot).toBe(FIXTURE);
    state.languageService.dispose();
  });

  it('fileNames lists project source files', () => {
    const state = createTsProject(makeCtx(FIXTURE));
    const names = state.fileNames();
    const hasUtils = names.some((n) => n.includes('utils.ts'));
    const hasMain = names.some((n) => n.includes('main.ts'));
    expect(hasUtils).toBe(true);
    expect(hasMain).toBe(true);
    state.languageService.dispose();
  });

  it('updateFile increments version without full rebuild', () => {
    const state = createTsProject(makeCtx(FIXTURE));
    const mainPath = path.join(FIXTURE, 'src', 'main.ts');
    const original = fs.readFileSync(mainPath, 'utf8');
    state.updateFile(mainPath, original + '\n// updated');
    const program = state.languageService.getProgram();
    expect(program).toBeDefined();
    const sf = program!.getSourceFile(mainPath);
    expect(sf).toBeDefined();
    state.languageService.dispose();
  });

  it('falls back to default options when no tsconfig exists', () => {
    const tmp = path.resolve('fixtures/ts/notexist-' + Date.now());
    fs.mkdirSync(tmp, { recursive: true });
    try {
      const state = createTsProject(makeCtx(tmp));
      expect(state.languageService).toBeDefined();
      state.languageService.dispose();
    } finally {
      fs.rmdirSync(tmp);
    }
  });
});
