import { describe, expect, it } from 'vitest';
import { importHealthReport } from '../server/importHealth';
import type { ImportHealthReport } from '../src/types';

const fileByPath = (report: ImportHealthReport, path: string) => report.files.find((f) => f.path === path)!;

describe('importHealthReport (GĐ 1)', () => {
  it('đánh dấu file không ai import là possibly-unused kèm bằng chứng + confidence', () => {
    const report = importHealthReport([
      { path: 'src/index.ts', content: "import { used } from './used';\nused();" },
      { path: 'src/used.ts', content: 'export function used() { return 1; }' },
      { path: 'src/orphan.ts', content: 'export function dead() { return 2; }' }
    ]);

    const orphan = fileByPath(report, 'src/orphan.ts');
    expect(orphan.verdict).toBe('possibly-unused');
    expect(orphan.importedBy).toBe(0);
    expect(orphan.confidence).toBeGreaterThan(0);
    expect(orphan.confidence).toBeLessThanOrEqual(85); // không bao giờ 100%
    expect(orphan.evidence.length).toBeGreaterThan(0);

    expect(fileByPath(report, 'src/used.ts').verdict).toBe('ok');
    expect(fileByPath(report, 'src/used.ts').importedBy).toBe(1);
    expect(report.summary.possiblyUnused).toBe(1);
  });

  it('coi index/main/test/config là entry, không gắn cờ thừa', () => {
    const report = importHealthReport([
      { path: 'index.ts', content: 'export const a = 1;' },
      { path: 'main.tsx', content: 'console.log("run");' },
      { path: 'foo.test.ts', content: 'test("x", () => {});' },
      { path: 'vite.config.ts', content: 'export default {};' }
    ]);
    for (const p of ['index.ts', 'main.tsx', 'foo.test.ts', 'vite.config.ts']) {
      expect(fileByPath(report, p).verdict).toBe('entry');
    }
    expect(report.summary.possiblyUnused).toBe(0);
    expect(report.summary.entryPoints).toBe(4);
  });

  it('phát hiện import tương đối gãy, bỏ qua bare package', () => {
    const report = importHealthReport([
      {
        path: 'index.ts',
        content: "import { x } from './missing';\nimport React from 'react';\nexport const y = x;"
      }
    ]);
    const f = fileByPath(report, 'index.ts');
    expect(f.unresolvedImports).toContain('./missing');
    expect(f.unresolvedImports).not.toContain('react'); // bare package = ngoài, không tính gãy
    expect(report.summary.unresolvedImports).toBe(1);
  });

  it('không coi import asset (css/svg/json) là gãy', () => {
    const report = importHealthReport([
      {
        path: 'main.tsx',
        content: "import './styles.css';\nimport logo from './logo.svg';\nimport data from './data.json';\nimport { real } from './missing';\nconsole.log(logo, data, real);"
      }
    ]);
    const f = fileByPath(report, 'main.tsx');
    expect(f.unresolvedImports).toEqual(['./missing']); // chỉ module JS/TS gãy, không phải asset
    expect(report.summary.unresolvedImports).toBe(1);
  });

  it('re-export (export ... from) cũng được tính là phụ thuộc', () => {
    const report = importHealthReport([
      { path: 'index.ts', content: "export { helper } from './lib';" },
      { path: 'lib.ts', content: 'export function helper() {}' }
    ]);
    expect(fileByPath(report, 'lib.ts').importedBy).toBe(1);
    expect(fileByPath(report, 'lib.ts').verdict).toBe('ok');
  });

  it('dynamic import() và require() cũng nối phụ thuộc (không báo nhầm thừa)', () => {
    const report = importHealthReport([
      { path: 'index.ts', content: "async function boot(){ await import('./lazy'); const u = require('./util'); return u; }\nboot();" },
      { path: 'lazy.ts', content: 'export const lazy = 1;' },
      { path: 'util.ts', content: 'module.exports = { x: 1 };' }
    ]);
    expect(fileByPath(report, 'lazy.ts').importedBy).toBe(1);
    expect(fileByPath(report, 'lazy.ts').verdict).toBe('ok');
    expect(fileByPath(report, 'util.ts').importedBy).toBe(1);
    expect(report.summary.possiblyUnused).toBe(0);
  });

  it('file có shebang là entry (không gắn cờ thừa)', () => {
    const report = importHealthReport([{ path: 'scripts/run.js', content: '#!/usr/bin/env node\nconsole.log("go");' }]);
    const f = fileByPath(report, 'scripts/run.js');
    expect(f.verdict).toBe('entry');
    expect(f.entryReason).toMatch(/shebang/i);
  });

  it('phát hiện parse-error (syntactic), không phải lỗi type', () => {
    const report = importHealthReport([
      { path: 'broken.ts', content: 'function bad( {' },
      { path: 'typeerr.ts', content: 'const n: number = "not a number"; export { n };' }
    ]);
    expect(fileByPath(report, 'broken.ts').verdict).toBe('parse-error');
    expect(fileByPath(report, 'broken.ts').error).toBeTruthy();
    expect(fileByPath(report, 'typeerr.ts').verdict).not.toBe('parse-error'); // lỗi type KHÔNG phải parse-error
    expect(report.summary.parseErrors).toBe(1);
  });
});
