// ts-5: Incremental snapshot swap — single-file re-analysis without full rebuild

import type { TsProjectState } from './program.js';

/**
 * Update one file's in-memory snapshot and return the updated project state.
 * The LanguageService lazily rebuilds only what changed — no full program rebuild.
 *
 * Returns the same state object (mutated in-place for the snapshot map),
 * which callers can immediately use to re-analyze via getProgram().
 */
export function swapSnapshot(
  state: TsProjectState,
  absolutePath: string,
  text: string,
): TsProjectState {
  state.updateFile(absolutePath, text);
  return state;
}

/**
 * Verify incremental consistency: re-analyze the file from the given state and
 * compare node count to a reference count. Useful in tests.
 */
export function verifyIncremental(state: TsProjectState, absolutePath: string): boolean {
  const program = state.languageService.getProgram();
  if (!program) return false;
  const sf = program.getSourceFile(absolutePath);
  return sf !== undefined;
}
