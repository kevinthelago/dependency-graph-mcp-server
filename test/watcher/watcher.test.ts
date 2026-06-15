import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, unlink, rename, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WorktreeWatcher, coalesceMoves } from '../../src/watcher/watcher.js';
import type { ChangeBatch } from '../../src/watcher/types.js';

/** Wait for the debounce window to pass, plus some buffer. */
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe('coalesceMoves (unit)', () => {
  it('pairs unlink+add in the same directory and extension as move', () => {
    const batch = coalesceMoves([
      { type: 'unlink', path: '/repo/src/foo.ts' },
      { type: 'add', path: '/repo/src/bar.ts' },
    ]);
    expect(batch).toEqual([
      { type: 'move', path: '/repo/src/bar.ts', oldPath: '/repo/src/foo.ts' },
    ]);
  });

  it('does not pair unlink+add in different directories', () => {
    const batch = coalesceMoves([
      { type: 'unlink', path: '/repo/src/foo.ts' },
      { type: 'add', path: '/repo/lib/foo.ts' },
    ]);
    expect(batch).toEqual([
      { type: 'unlink', path: '/repo/src/foo.ts' },
      { type: 'add', path: '/repo/lib/foo.ts' },
    ]);
  });

  it('does not pair unlink+add with different extensions', () => {
    const batch = coalesceMoves([
      { type: 'unlink', path: '/repo/src/foo.ts' },
      { type: 'add', path: '/repo/src/foo.js' },
    ]);
    expect(batch).toEqual([
      { type: 'unlink', path: '/repo/src/foo.ts' },
      { type: 'add', path: '/repo/src/foo.js' },
    ]);
  });

  it('passes through change events untouched', () => {
    const batch = coalesceMoves([{ type: 'change', path: '/repo/src/foo.ts' }]);
    expect(batch).toEqual([{ type: 'change', path: '/repo/src/foo.ts' }]);
  });

  it('emits unpaired unlink when there is no matching add', () => {
    const batch = coalesceMoves([{ type: 'unlink', path: '/repo/src/gone.ts' }]);
    expect(batch).toEqual([{ type: 'unlink', path: '/repo/src/gone.ts' }]);
  });

  it('handles a batch with multiple independent events', () => {
    const batch = coalesceMoves([
      { type: 'change', path: '/repo/a.ts' },
      { type: 'unlink', path: '/repo/old.ts' },
      { type: 'add', path: '/repo/new.ts' },
      { type: 'add', path: '/repo/fresh.ts' },
    ]);
    expect(batch).toContainEqual({ type: 'move', path: '/repo/new.ts', oldPath: '/repo/old.ts' });
    expect(batch).toContainEqual({ type: 'add', path: '/repo/fresh.ts' });
    expect(batch).toContainEqual({ type: 'change', path: '/repo/a.ts' });
    expect(batch.length).toBe(3);
  });
});

describe('WorktreeWatcher (integration)', () => {
  let dir: string;
  let watcher: WorktreeWatcher | undefined;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'watcher-test-'));
  });

  afterEach(async () => {
    if (watcher !== undefined) {
      await watcher.stop();
      watcher = undefined;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('detects a new file', async () => {
    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 80 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100); // let chokidar finish setup before writing

    await writeFile(join(dir, 'hello.ts'), 'export const x = 1;');
    await wait(250);

    expect(batches.length).toBeGreaterThanOrEqual(1);
    const allEvents = batches.flat();
    expect(allEvents).toContainEqual(expect.objectContaining({ type: 'add', path: join(dir, 'hello.ts') }));
  });

  it('detects a file modification', async () => {
    const existing = join(dir, 'mod.ts');
    await writeFile(existing, 'v1');

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 80 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100); // let chokidar settle after start

    await writeFile(existing, 'v2');
    await wait(200);

    const allEvents = batches.flat();
    expect(allEvents).toContainEqual(expect.objectContaining({ type: 'change', path: existing }));
  });

  it('detects file deletion', async () => {
    const target = join(dir, 'bye.ts');
    await writeFile(target, 'export const gone = true;');

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 80 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100);

    await unlink(target);
    await wait(200);

    const allEvents = batches.flat();
    expect(allEvents).toContainEqual(expect.objectContaining({ type: 'unlink', path: target }));
  });

  it('coalesces rapid changes to the same file into a single event', async () => {
    const file = join(dir, 'rapid.ts');
    await writeFile(file, 'v0');

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 120 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100);

    await writeFile(file, 'v1');
    await wait(20);
    await writeFile(file, 'v2');
    await wait(20);
    await writeFile(file, 'v3');
    await wait(250); // wait for debounce to expire

    const pathEvents = batches.flat().filter((e) => e.path === file);
    expect(pathEvents.length).toBe(1);
  });

  it('drops transient files (add then unlink within the same window)', async () => {
    const transient = join(dir, 'transient.ts');

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 200 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100);

    // Create and immediately delete within the debounce window.
    await writeFile(transient, 'tmp');
    await unlink(transient);
    await wait(350);

    const allEvents = batches.flat();
    expect(allEvents.filter((e) => e.path === transient).length).toBe(0);
  });

  it('detects a rename as a move event (same directory)', async () => {
    const oldPath = join(dir, 'old.ts');
    const newPath = join(dir, 'new.ts');
    await writeFile(oldPath, 'export const x = 1;');

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 120 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100);

    await rename(oldPath, newPath);
    await wait(300);

    const allEvents = batches.flat();
    const moves = allEvents.filter((e) => e.type === 'move');
    expect(moves.length).toBe(1);
    expect(moves[0]).toMatchObject({ type: 'move', path: newPath, oldPath });
  });

  it('respects caller-supplied ignore globs', async () => {
    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher(
      [dir],
      { debounceMs: 80, ignored: ['**/*.log'] },
      async (b) => { batches.push(b); },
    );
    watcher.start();
    await wait(100);

    await writeFile(join(dir, 'ignored.log'), 'noise');
    await writeFile(join(dir, 'watched.ts'), 'signal');
    await wait(200);

    const allEvents = batches.flat();
    expect(allEvents.every((e) => !e.path.endsWith('.log'))).toBe(true);
    expect(allEvents).toContainEqual(expect.objectContaining({ path: join(dir, 'watched.ts') }));
  });

  it('watches subdirectories', async () => {
    const sub = join(dir, 'subdir');
    await mkdir(sub);

    const batches: ChangeBatch[] = [];
    watcher = new WorktreeWatcher([dir], { debounceMs: 80 }, async (b) => {
      batches.push(b);
    });
    watcher.start();
    await wait(100);

    await writeFile(join(sub, 'nested.ts'), 'export const n = 1;');
    await wait(200);

    const allEvents = batches.flat();
    expect(allEvents).toContainEqual(
      expect.objectContaining({ type: 'add', path: join(sub, 'nested.ts') }),
    );
  });
});
