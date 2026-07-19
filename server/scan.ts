import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isIgnoredSourcePath,
  isSupportedSourcePath,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES
} from '../src/sourceFiles';
import type { SourceFileInput } from '../src/types';

export class SourceScanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceScanLimitError';
  }
}

export async function collectSourceFiles(root: string): Promise<SourceFileInput[]> {
  const files: SourceFileInput[] = [];
  const state = { totalBytes: 0 };
  await walk(root, root, files, state);
  return files;
}

async function walk(root: string, dir: string, files: SourceFileInput[], state: { totalBytes: number }) {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!isIgnoredSourcePath(entry.name)) await walk(root, full, files, state);
      continue;
    }
    if (!entry.isFile() || !isSupportedSourcePath(entry.name)) continue;
    const info = await stat(full);
    if (info.size > MAX_SOURCE_FILE_BYTES) continue;
    if (files.length >= MAX_SOURCE_FILES) {
      throw new SourceScanLimitError(`Repo có hơn ${MAX_SOURCE_FILES} file nguồn; hãy quét một thư mục hẹp hơn.`);
    }
    if (state.totalBytes + info.size > MAX_SOURCE_BYTES) {
      throw new SourceScanLimitError(`Tổng source vượt ${MAX_SOURCE_BYTES} byte; hãy quét một thư mục hẹp hơn.`);
    }
    files.push({
      path: path.relative(root, full).replace(/\\/g, '/'),
      content: await readFile(full, 'utf8')
    });
    state.totalBytes += info.size;
  }
}
