import { describe, expect, it } from 'vitest';
import { changeGate, radarGate, runContractCli } from '../server/contractCli';
import { verifyChangeContract } from '../server/changeContract';
import { contractRadarReport } from '../server/contractRadar';

describe('contract CI gate', () => {
  it('fail khi Contract Radar có lỗi chắc chắn', () => {
    const report = contractRadarReport([{ path: 'client.ts', content: `fetch('/api/missing');` }]);
    const gate = radarGate(report);

    expect(gate).toMatchObject({ mode: 'radar', passed: false, exitCode: 1, errors: 1 });
  });

  it('unknown fail-closed mặc định nhưng có thể waiver tường minh', () => {
    const report = contractRadarReport([{ path: 'client.ts', content: `fetch(url);` }]);

    expect(radarGate(report)).toMatchObject({ passed: false, unknowns: 1 });
    expect(radarGate(report, true)).toMatchObject({ passed: true, exitCode: 0, unknowns: 1 });
  });

  it('dùng đúng PASS/FAIL của Change Contract', async () => {
    const before = [{ path: 'main.ts', content: `export function main(){ return 1; }` }];
    const safe = [{ path: 'main.ts', content: `export function main(){ return 2; }` }];
    const unsafe = [{ path: 'main.ts', content: `export const value = 2;` }];

    expect(changeGate(await verifyChangeContract(before, safe))).toMatchObject({ passed: true, exitCode: 0 });
    expect(changeGate(await verifyChangeContract(before, unsafe))).toMatchObject({ passed: false, exitCode: 1, errors: 1 });
  });

  it('từ chối cờ CLI thiếu giá trị hoặc policy đặt sai mode', async () => {
    await expect(runContractCli(['--before'])).rejects.toThrow('--before cần một giá trị.');
    await expect(runContractCli(['--policy', 'contract.json'])).rejects.toThrow('--policy chỉ dùng cùng --before và --after.');
  });
});
