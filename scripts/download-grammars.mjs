#!/usr/bin/env node
/**
 * Downloads pre-compiled tree-sitter WASM grammars from GitHub releases.
 * Run with: pnpm prepare:wasm
 * Output: vendor/grammars/<lang>.wasm  (git-ignored)
 */
import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'vendor', 'grammars')

mkdirSync(OUT, { recursive: true })

const GRAMMARS = [
  {
    lang: 'python',
    url: 'https://github.com/tree-sitter/tree-sitter-python/releases/download/v0.23.6/tree-sitter-python.wasm',
    file: 'tree-sitter-python.wasm',
  },
]

for (const { lang, url, file } of GRAMMARS) {
  const dest = join(OUT, file)
  console.log(`Downloading ${lang} grammar…`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  await pipeline(res.body, createWriteStream(dest))
  console.log(`  → ${dest}`)
}

console.log('Done.')
