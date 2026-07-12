import { describe, expect, it } from 'vitest';
import { simulateChange } from '../server/simulate';
import type { SourceFileInput } from '../src/types';

// main → helper → util ;  main → loopA ;  loopA ↔ loopB (vòng gọi)
const SAMPLE: SourceFileInput[] = [
  { path: 'a.js', content: 'function main(){ helper(); loopA(); }\nfunction helper(){ return util(); }' },
  { path: 'b.js', content: 'function loopA(){ return loopB(); }\nfunction loopB(){ return loopA(); }\nfunction util(){ return 1; }' }
];

describe('simulateChange (Refactor Sandbox)', () => {
  it('xoá một hàm phá vòng gọi và báo nơi gọi gãy', async () => {
    const r = await simulateChange(SAMPLE, { kind: 'delete-function', target: 'b.js#loopB' });
    expect(r.found).toBe(true);
    expect(r.removed.functions).toBe(1);
    expect(r.metrics.functionsInCycle.before).toBe(2);
    expect(r.metrics.functionsInCycle.after).toBe(0); // phá vòng loopA↔loopB
    expect(r.brokenCallers.map((c) => c.id)).toContain('b.js#loopA'); // loopA gọi loopB → gãy
  });

  it('xoá file bỏ mọi hàm trong file và gắn cờ nơi gọi', async () => {
    const r = await simulateChange(SAMPLE, { kind: 'delete-file', target: 'b.js' });
    expect(r.found).toBe(true);
    expect(r.removed.functions).toBe(3); // loopA, loopB, util
    expect(r.removed.files).toEqual(['b.js']);
    const brokenIds = r.brokenCallers.map((c) => c.id);
    expect(brokenIds).toContain('a.js#main'); // main gọi loopA
    expect(brokenIds).toContain('a.js#helper'); // helper gọi util
    expect(r.metrics.functions.before - r.metrics.functions.after).toBe(3);
  });

  it('phát hiện hàm thành mồ côi sau khi xoá', async () => {
    const r = await simulateChange(SAMPLE, { kind: 'delete-function', target: 'a.js#helper' });
    expect(r.newlyOrphaned.map((o) => o.id)).toContain('b.js#util'); // util chỉ được helper gọi
    expect(r.brokenCallers.map((c) => c.id)).toContain('a.js#main'); // main gọi helper
  });

  it('target không tồn tại → found=false, không xoá gì', async () => {
    const r = await simulateChange(SAMPLE, { kind: 'delete-function', target: 'a.js#khongco' });
    expect(r.found).toBe(false);
    expect(r.removed.functions).toBe(0);
    expect(r.summary[0]).toMatch(/Không tìm thấy/);
  });
});
