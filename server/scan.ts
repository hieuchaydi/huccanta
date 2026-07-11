import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { SourceFileInput } from '../src/types';

// JS/TS (ts-morph) + các ngôn ngữ tree-sitter (Python/Java/Go/C/C++/C#...).
const SOURCE_EXT = /\.(cjs|mjs|mts|cts|js|jsx|ts|tsx|py|pyi|java|go|c|h|cpp|cc|cxx|hpp|hh|hxx|cs)$/i;
const IGNORE_DIRS = new Set([
  '.git',
  '.next',
  '.turbo',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out'
]);

export async function collectSourceFiles(root: string): Promise<SourceFileInput[]> {
  const files: SourceFileInput[] = [];
  await walk(root, root, files);
  return files;
}

async function walk(root: string, dir: string, files: SourceFileInput[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORE_DIRS.has(entry.name)) await walk(root, full, files);
      continue;
    }
    if (!entry.isFile() || !SOURCE_EXT.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    const info = await stat(full);
    if (info.size > 800_000) continue;
    files.push({
      path: path.relative(root, full).replace(/\\/g, '/'),
      content: await readFile(full, 'utf8')
    });
  }
}
