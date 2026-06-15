/**
 * STUB — replaced by core (core-1..core-9) when it lands on develop.
 *
 * This file exists so that vitest can resolve the import path and apply
 * vi.mock() in the explore-tool test suites. No code here runs in tests —
 * the entire module is mocked.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

import type { GraphView } from './store.js';

export function composedView(_worktreeId: string | null | undefined): GraphView | null {
  throw new Error('composedView (core-1..9) not yet installed');
}
