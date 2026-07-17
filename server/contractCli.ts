import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ChangeContractPolicy, ChangeContractResult, ContractRadarReport } from '../src/types';
import { verifyChangeContract } from './changeContract';
import { contractRadarReport } from './contractRadar';
import { collectSourceFiles } from './scan';

export interface ContractGateResult {
  mode: 'radar' | 'change';
  passed: boolean;
  exitCode: 0 | 1;
  errors: number;
  unknowns: number;
  report: ContractRadarReport | ChangeContractResult;
}

export function radarGate(report: ContractRadarReport, allowUnknown = false): ContractGateResult {
  const errors = report.issues.filter((issue) => issue.severity === 'error').length;
  const unknowns = report.unknowns.length;
  const passed = errors === 0 && (allowUnknown || unknowns === 0);
  return { mode: 'radar', passed, exitCode: passed ? 0 : 1, errors, unknowns, report };
}

export function changeGate(report: ChangeContractResult, allowUnknown = false): ContractGateResult {
  const errors = report.checks.filter((check) => check.status === 'fail').length;
  const unknowns = report.checks.filter((check) => check.status === 'unknown').length;
  const passed = errors === 0 && (report.status === 'pass' || (allowUnknown && report.status === 'unknown'));
  return { mode: 'change', passed, exitCode: passed ? 0 : 1, errors, unknowns, report };
}

interface ParsedArgs {
  path?: string;
  before?: string;
  after?: string;
  policy?: string;
  json: boolean;
  allowUnknown: boolean;
}

function parseArgs(args: string[]): ParsedArgs {
  const parsed: ParsedArgs = { json: false, allowUnknown: false };
  const valueAfter = (flag: string, index: number) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} cần một giá trị.`);
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') parsed.json = true;
    else if (arg === '--allow-unknown') parsed.allowUnknown = true;
    else if (arg === '--before') parsed.before = valueAfter(arg, index++);
    else if (arg === '--after') parsed.after = valueAfter(arg, index++);
    else if (arg === '--policy') parsed.policy = valueAfter(arg, index++);
    else if (arg === '--path') parsed.path = valueAfter(arg, index++);
    else if (!arg.startsWith('-') && !parsed.path) parsed.path = arg;
    else throw new Error(`Tham số không hợp lệ: ${arg}`);
  }
  if (parsed.policy && !parsed.before && !parsed.after) {
    throw new Error('--policy chỉ dùng cùng --before và --after.');
  }
  return parsed;
}

async function readPolicy(file: string | undefined): Promise<ChangeContractPolicy> {
  if (!file) return {};
  return JSON.parse(await readFile(path.resolve(file), 'utf8')) as ChangeContractPolicy;
}

function humanSummary(result: ContractGateResult) {
  if (result.mode === 'radar') {
    const report = result.report as ContractRadarReport;
    const lines = [
      `Contract Radar: ${result.passed ? 'PASS' : 'FAIL'}`,
      `${report.summary.clientCalls} client calls · ${report.summary.serverRoutes} routes · ${report.summary.matches} matches`,
      `${result.errors} errors · ${result.unknowns} unknowns`
    ];
    for (const issue of report.issues.filter((item) => item.severity === 'error')) lines.push(`- ${issue.kind}: ${issue.message}`);
    if (result.unknowns > 0) lines.push(`- unknown: ${report.unknowns[0]?.reason}${result.unknowns > 1 ? ` (+${result.unknowns - 1})` : ''}`);
    return lines.join('\n');
  }
  const report = result.report as ChangeContractResult;
  const lines = [
    `Change Contract: ${report.status.toUpperCase()}`,
    `${result.errors} failed checks · ${result.unknowns} unknown checks`,
    `fingerprint: ${report.fingerprint}`
  ];
  for (const check of report.checks.filter((item) => item.status !== 'pass')) lines.push(`- ${check.id}: ${check.summary}`);
  return lines.join('\n');
}

export async function runContractCli(args = process.argv.slice(2)) {
  const parsed = parseArgs(args);
  let result: ContractGateResult;
  if (parsed.before || parsed.after) {
    if (!parsed.before || !parsed.after) throw new Error('Change gate cần cả --before và --after.');
    const [before, after, policy] = await Promise.all([
      collectSourceFiles(path.resolve(parsed.before)),
      collectSourceFiles(path.resolve(parsed.after)),
      readPolicy(parsed.policy)
    ]);
    result = changeGate(await verifyChangeContract(before, after, policy), parsed.allowUnknown);
  } else {
    const root = path.resolve(parsed.path ?? '.');
    result = radarGate(contractRadarReport(await collectSourceFiles(root)), parsed.allowUnknown);
  }
  process.stdout.write(`${parsed.json ? JSON.stringify(result, null, 2) : humanSummary(result)}\n`);
  return result.exitCode;
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entry === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runContractCli();
  } catch (error) {
    process.stderr.write(`Huccanta contract gate: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
