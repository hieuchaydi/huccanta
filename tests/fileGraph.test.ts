import { describe, expect, it } from 'vitest';
import { fileGraphReport } from '../server/fileGraph';
import { importHealthReport } from '../server/importHealth';
import type { SourceFileInput } from '../src/types';

const node = (g: ReturnType<typeof fileGraphReport>, path: string) => g.nodes.find((n) => n.path === path);

describe('fileGraphReport', () => {
  it('builds a linear import chain with entry/orphan classification', () => {
    const files: SourceFileInput[] = [
      { path: 'main.ts', content: "import { b } from './b'; export const run = () => b();" },
      { path: 'b.ts', content: "import { c } from './c'; export const b = () => c();" },
      { path: 'c.ts', content: 'export const c = () => 1;' }
    ];
    const g = fileGraphReport(files);

    expect(g.nodes).toHaveLength(3);
    expect(g.edges.map((e) => `${e.from}>${e.to}`).sort()).toEqual(['b.ts>c.ts', 'main.ts>b.ts']);
    expect(g.summary.cycles).toBe(0);
    expect(g.summary.filesInCycle).toBe(0);

    // main.ts khớp ENTRY_NAME → entry (dù không ai import).
    expect(node(g, 'main.ts')?.kind).toBe('entry');
    expect(node(g, 'main.ts')?.imports).toBe(1);
    expect(node(g, 'c.ts')?.importedBy).toBe(1);
    expect(node(g, 'c.ts')?.kind).toBe('normal');
  });

  it('flags a two-file import cycle', () => {
    const files: SourceFileInput[] = [
      { path: 'x.ts', content: "import { y } from './y'; export const x = () => y();" },
      { path: 'y.ts', content: "import { x } from './x'; export const y = () => x();" }
    ];
    const g = fileGraphReport(files);

    expect(node(g, 'x.ts')?.inCycle).toBe(true);
    expect(node(g, 'y.ts')?.inCycle).toBe(true);
    expect(g.edges.every((e) => e.cycle)).toBe(true);
    expect(g.summary.cycles).toBe(1);
    expect(g.summary.filesInCycle).toBe(2);
  });

  it('counts broken relative imports but not asset imports', () => {
    const files: SourceFileInput[] = [
      { path: 'main.ts', content: "import './styles.css'; import { gone } from './khong-ton-tai'; export const z = () => gone;" }
    ];
    const g = fileGraphReport(files);
    expect(node(g, 'main.ts')?.unresolved).toBe(1);
    expect(g.summary.unresolvedImports).toBe(1);
  });

  it('creates edges for dynamic import() and require()', () => {
    const files: SourceFileInput[] = [
      { path: 'main.ts', content: "export async function load(){ const m = await import('./lazy'); return m; }" },
      { path: 'lazy.ts', content: 'export const lazy = 1;' },
      { path: 'other.ts', content: "const r = require('./lazy'); module.exports = r;" }
    ];
    const g = fileGraphReport(files);
    const edgeKeys = g.edges.map((e) => `${e.from}>${e.to}`).sort();
    expect(edgeKeys).toContain('main.ts>lazy.ts');
    expect(edgeKeys).toContain('other.ts>lazy.ts');
    expect(node(g, 'lazy.ts')?.importedBy).toBe(2);
  });
});

describe('importHealthReport (không hồi quy sau refactor collectFileDeps)', () => {
  it('still marks entry points and possibly-unused files', () => {
    const files: SourceFileInput[] = [
      { path: 'index.ts', content: "import { a } from './used'; export const main = () => a();" },
      { path: 'used.ts', content: 'export const a = () => 1;' },
      { path: 'orphan.ts', content: 'export const dangling = () => 42;' }
    ];
    const report = importHealthReport(files);
    const byPath = new Map(report.files.map((f) => [f.path, f]));

    expect(byPath.get('index.ts')?.verdict).toBe('entry');
    expect(byPath.get('used.ts')?.verdict).toBe('ok');
    expect(byPath.get('orphan.ts')?.verdict).toBe('possibly-unused');
    expect(byPath.get('orphan.ts')?.confidence).toBeGreaterThan(0);
    expect(report.summary.entryPoints).toBe(1);
    expect(report.summary.possiblyUnused).toBe(1);
  });
});
