/**
 * Shared conformance suite for the C/C++ analyser (cpp-3, issue #59).
 *
 * Runs the common conformance harness against a representative set of fixtures
 * covering: quoted vs. angled includes, header/source pairs, external leaves,
 * and symbol extraction.
 */

import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CppAnalyzer } from '../../../src/analyzers/cpp/index.js';
import { fileId } from '../../../src/graph/node-id.js';
import { runConformanceSuite } from '../../conformance/shared.js';
import type { ConformanceFixture } from '../../conformance/shared.js';

// Navigate from test/analyzers/cpp/ up to project root, then into fixtures/cpp
const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/cpp', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

function fixture(relPath: string): string {
  return join(FIXTURES_DIR, relPath);
}

function read(relPath: string): string {
  return readFileSync(fixture(relPath), 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const basicRoot = fixture('basic');
const cppClassRoot = fixture('cpp-class');
const systemRoot = fixture('system');
const quotedRoot = fixture('quoted-vs-angled');

const conformanceFixtures: ConformanceFixture[] = [
  // ── basic/main.c: quoted include resolves in-project ──────────────────────
  {
    filePath: fixture('basic/main.c'),
    content: read('basic/main.c'),
    ctx: { repoRoot: basicRoot },
    expectedFileId: fileId(fixture('basic/main.c')),
    expectedSymbols: ['main'],
    expectedExternalIncludes: ['ext:stdio.h'],
    expectsInProjectImport: true,
  },

  // ── basic/util.h: macro and symbol extraction ──────────────────────────────
  {
    filePath: fixture('basic/util.h'),
    content: read('basic/util.h'),
    ctx: { repoRoot: basicRoot },
    expectedFileId: fileId(fixture('basic/util.h')),
    expectedSymbols: ['add', 'multiply', 'Point', 'MAX'],
  },

  // ── cpp-class/Shape.hpp: C++ class detection ───────────────────────────────
  {
    filePath: fixture('cpp-class/Shape.hpp'),
    content: read('cpp-class/Shape.hpp'),
    ctx: { repoRoot: cppClassRoot },
    expectedFileId: fileId(fixture('cpp-class/Shape.hpp')),
    expectedSymbols: ['geometry', 'Shape', 'Circle'],
    expectedExternalIncludes: ['ext:string'],
  },

  // ── cpp-class/Shape.cpp: C++ source with in-project include ───────────────
  {
    filePath: fixture('cpp-class/Shape.cpp'),
    content: read('cpp-class/Shape.cpp'),
    ctx: { repoRoot: cppClassRoot },
    expectedFileId: fileId(fixture('cpp-class/Shape.cpp')),
    expectsInProjectImport: true,
    expectedExternalIncludes: ['ext:cmath', 'ext:utility'],
  },

  // ── system/main.c: system includes become external leaves ─────────────────
  {
    filePath: fixture('system/main.c'),
    content: read('system/main.c'),
    ctx: { repoRoot: systemRoot },
    expectedFileId: fileId(fixture('system/main.c')),
    expectedSymbols: ['greet'],
    expectedExternalIncludes: [
      'ext:stdio.h',
      'ext:stdlib.h',
      'ext:string.h',
    ],
  },

  // ── quoted-vs-angled/main.c: both quote styles ────────────────────────────
  {
    filePath: fixture('quoted-vs-angled/main.c'),
    content: read('quoted-vs-angled/main.c'),
    ctx: { repoRoot: quotedRoot },
    expectedFileId: fileId(fixture('quoted-vs-angled/main.c')),
    expectedSymbols: ['process', 'main'],
    expectsInProjectImport: true,
    expectedExternalIncludes: [
      'ext:string.h',
      'ext:stdlib.h',
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Run the suite
// ─────────────────────────────────────────────────────────────────────────────

runConformanceSuite(new CppAnalyzer(), conformanceFixtures);
