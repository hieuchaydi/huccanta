import { describe, expect, it } from 'vitest';
import { verifyChangeContract } from '../server/changeContract';
import type { SourceFileInput } from '../src/types';

const BEFORE: SourceFileInput[] = [
  {
    path: 'src/main.ts',
    content: `import { helper } from './helper';\nexport function main(){ return helper(); }`
  },
  {
    path: 'src/helper.ts',
    content: `export function helper(){ return 1; }`
  }
];

function check(result: Awaited<ReturnType<typeof verifyChangeContract>>, id: string) {
  return result.checks.find((item) => item.id === id)!;
}

describe('verifyChangeContract', () => {
  it('pass cho thay đổi trong ngân sách và tạo fingerprint không phụ thuộc thứ tự file', async () => {
    const after: SourceFileInput[] = [
      BEFORE[0],
      { path: 'src/helper.ts', content: `export function helper(){ return 2; }` }
    ];
    const policy = {
      name: 'đổi implementation helper',
      preserve: { files: ['src/helper.ts'], functions: ['src/helper.ts#helper'] }
    };

    const first = await verifyChangeContract(BEFORE, after, policy);
    const reordered = await verifyChangeContract([...BEFORE].reverse(), [...after].reverse(), policy);

    expect(first.status).toBe('pass');
    expect(first.accepted).toBe(true);
    expect(first.changes.files.modified).toEqual(['src/helper.ts']);
    expect(first.fingerprint).toBe(reordered.fingerprint);
    expect(first.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('fail và nêu đúng bằng chứng khi patch thêm import gãy', async () => {
    const after: SourceFileInput[] = [
      {
        path: 'src/main.ts',
        content: `import { helper } from './helper';\nimport { lost } from './missing';\nexport function main(){ return helper() + lost(); }`
      },
      BEFORE[1]
    ];

    const result = await verifyChangeContract(BEFORE, after);

    expect(result.status).toBe('fail');
    expect(result.changes.unresolvedImports.added).toEqual(['src/main.ts -> ./missing']);
    expect(check(result, 'unresolved-import-budget')).toMatchObject({ status: 'fail' });
    expect(check(result, 'unresolved-import-budget').evidence).toContain('src/main.ts -> ./missing');
  });

  it('bắt hàm bị xoá ngoài allow-list và pass khi ý định đã khai báo', async () => {
    const after: SourceFileInput[] = [
      BEFORE[0],
      { path: 'src/helper.ts', content: `export const helperValue = 1;` }
    ];

    const denied = await verifyChangeContract(BEFORE, after);
    const allowed = await verifyChangeContract(BEFORE, after, {
      allow: { removedFunctions: ['src/helper.ts#helper'] }
    });

    expect(check(denied, 'removed-functions-declared')).toMatchObject({ status: 'fail' });
    expect(check(denied, 'removed-functions-declared').evidence).toEqual(['src/helper.ts#helper']);
    expect(allowed.status).toBe('pass');
  });

  it('fail khi patch tạo file cycle và call cycle mới', async () => {
    const before: SourceFileInput[] = [
      { path: 'src/a.ts', content: `export function a(){ return 1; }` },
      { path: 'src/b.ts', content: `export function b(){ return 1; }` }
    ];
    const after: SourceFileInput[] = [
      { path: 'src/a.ts', content: `import { b } from './b';\nexport function a(){ return b(); }` },
      { path: 'src/b.ts', content: `import { a } from './a';\nexport function b(){ return a(); }` }
    ];

    const result = await verifyChangeContract(before, after);

    expect(result.status).toBe('fail');
    expect(result.changes.filesEnteringCycles).toEqual(['src/a.ts', 'src/b.ts']);
    expect(result.changes.functionsEnteringCycles).toEqual(['src/a.ts#a', 'src/b.ts#b']);
    expect(check(result, 'file-cycle-budget').status).toBe('fail');
    expect(check(result, 'function-cycle-budget').status).toBe('fail');
  });

  it('fail khi một hàm hiện hữu trở thành hotspot mới', async () => {
    const branches = Array.from({ length: 11 }, (_, index) => `if (x === ${index}) return ${index};`).join('\n');
    const before: SourceFileInput[] = [{ path: 'src/calc.ts', content: `export function calc(x: number){ return x; }` }];
    const after: SourceFileInput[] = [
      { path: 'src/calc.ts', content: `export function calc(x: number){\n${branches}\nreturn x;\n}` }
    ];

    const result = await verifyChangeContract(before, after);

    expect(result.changes.newHotspots).toEqual(['src/calc.ts#calc']);
    expect(check(result, 'hotspot-budget').status).toBe('fail');
  });

  it('trả unknown và fail-closed khi snapshot có lỗi parse', async () => {
    const after: SourceFileInput[] = [
      BEFORE[0],
      { path: 'src/helper.ts', content: `export function helper( {` }
    ];

    const result = await verifyChangeContract(BEFORE, after);

    expect(result.status).toBe('unknown');
    expect(result.accepted).toBe(false);
    expect(check(result, 'analysis-complete').status).toBe('unknown');
    expect(check(result, 'analysis-complete').evidence.join('\n')).toContain('after: src/helper.ts');
    expect(check(result, 'hotspot-budget').status).toBe('unknown');
  });
});
