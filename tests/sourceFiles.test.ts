import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectSourceFiles } from '../server/scan';
import {
  isIgnoredSourcePath,
  isJavaScriptSourcePath,
  isSupportedSourcePath,
  MAX_SOURCE_FILE_BYTES
} from '../src/sourceFiles';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('shared source-file policy', () => {
  it('keeps UI and server language support aligned', () => {
    for (const file of ['a.ts', 'a.mts', 'a.jsx', 'a.py', 'a.pyi', 'A.JAVA', 'a.go', 'a.c', 'a.hpp', 'a.cs']) {
      expect(isSupportedSourcePath(file), file).toBe(true);
    }
    expect(isSupportedSourcePath('types.d.ts')).toBe(false);
    expect(isSupportedSourcePath('styles.css')).toBe(false);
    expect(isJavaScriptSourcePath('src/app.tsx')).toBe(true);
    expect(isJavaScriptSourcePath('src/app.py')).toBe(false);
  });

  it('ignores generated/vendor directories case-insensitively', () => {
    expect(isIgnoredSourcePath('src/app.ts')).toBe(false);
    expect(isIgnoredSourcePath('vendor/lib.go')).toBe(true);
    expect(isIgnoredSourcePath('pkg\\Node_Modules\\x.js')).toBe(true);
    expect(isIgnoredSourcePath('.svelte-kit/output/app.js')).toBe(true);
  });

  it('scans deterministically and skips ignored, declaration, and oversized files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'huccanta-scan-test-'));
    temporaryRoots.push(root);
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await mkdir(path.join(root, 'vendor'), { recursive: true });
    await writeFile(path.join(root, 'z.py'), 'def z():\n    pass\n');
    await writeFile(path.join(root, 'a.ts'), 'export const a = 1;\n');
    await writeFile(path.join(root, 'types.d.ts'), 'declare const x: number;\n');
    await writeFile(path.join(root, 'huge.js'), 'x'.repeat(MAX_SOURCE_FILE_BYTES + 1));
    await writeFile(path.join(root, 'node_modules', 'hidden.ts'), 'export const hidden = true;\n');
    await writeFile(path.join(root, 'vendor', 'hidden.go'), 'package hidden\n');

    const files = await collectSourceFiles(root);
    expect(files.map((file) => file.path)).toEqual(['a.ts', 'z.py']);
  });
});
