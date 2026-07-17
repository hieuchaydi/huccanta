// Change Contract — so sánh hai snapshot JS/TS và kiểm ý định thay đổi đã khai báo.
// Kết quả là chứng thư cấu trúc deterministic (pass/fail/unknown), không phải formal proof
// hay bằng chứng tương đương hành vi runtime.
import { createHash } from 'node:crypto';
import type {
  ChangeContractPolicy,
  ChangeContractResult,
  ContractCheck,
  ContractMetrics,
  ContractStatus,
  Graph,
  ImportHealthReport,
  NormalizedChangeContractPolicy,
  SourceFileInput
} from '../src/types';
import { analyzeProject } from './analyze';
import { fileGraphReport } from './fileGraph';
import { importHealthReport } from './importHealth';
import { JS_TS, TYPE_DECL, normalizePath } from './moduleGraph';

const EVIDENCE_LIMIT = 50;

interface SnapshotAnalysis {
  files: SourceFileInput[];
  graph: Graph;
  health: ImportHealthReport;
  fileCycles: Set<string>;
  functions: Set<string>;
  functionCycles: Set<string>;
  hotspots: Set<string>;
  unresolved: Set<string>;
  parseErrors: string[];
  analyzableFiles: number;
  unsupportedFiles: string[];
  metrics: ContractMetrics;
}

function canonicalFiles(files: SourceFileInput[]): SourceFileInput[] {
  const byPath = new Map<string, string>();
  for (const file of files) {
    const path = normalizePath(String(file.path ?? ''));
    if (!path) throw new Error('Đường dẫn file trong Change Contract không được để trống.');
    if (byPath.has(path)) throw new Error(`Snapshot chứa đường dẫn file trùng nhau: ${path}`);
    byPath.set(path, String(file.content ?? ''));
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({ path, content }));
}

function normalizeFunctionId(id: string) {
  const value = id.trim();
  const separator = value.indexOf('#');
  if (separator === -1) return value;
  return `${normalizePath(value.slice(0, separator))}${value.slice(separator)}`;
}

function uniqueSorted(values: string[], normalizer: (value: string) => string = (value) => value.trim()) {
  return [...new Set(values.map(normalizer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function limit(value: number | undefined, field: string) {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Change Contract "${field}" phải là số nguyên không âm.`);
  }
  return value;
}

export function normalizeChangeContractPolicy(policy: ChangeContractPolicy = {}): NormalizedChangeContractPolicy {
  return {
    name: policy.name?.trim() || 'unnamed-change',
    allow: {
      removedFiles: uniqueSorted(policy.allow?.removedFiles ?? [], normalizePath),
      removedFunctions: uniqueSorted(policy.allow?.removedFunctions ?? [], normalizeFunctionId)
    },
    preserve: {
      files: uniqueSorted(policy.preserve?.files ?? [], normalizePath),
      functions: uniqueSorted(policy.preserve?.functions ?? [], normalizeFunctionId)
    },
    limits: {
      maxNewUnresolvedImports: limit(policy.limits?.maxNewUnresolvedImports, 'maxNewUnresolvedImports'),
      maxNewFilesInCycles: limit(policy.limits?.maxNewFilesInCycles, 'maxNewFilesInCycles'),
      maxNewFunctionsInCycles: limit(policy.limits?.maxNewFunctionsInCycles, 'maxNewFunctionsInCycles'),
      maxNewHotspots: limit(policy.limits?.maxNewHotspots, 'maxNewHotspots')
    }
  };
}

function digest(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function filesDigest(files: SourceFileInput[]) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function difference(after: Set<string>, before: Set<string>) {
  return [...after].filter((value) => !before.has(value)).sort((a, b) => a.localeCompare(b));
}

function sample(values: string[]) {
  if (values.length <= EVIDENCE_LIMIT) return values;
  return [...values.slice(0, EVIDENCE_LIMIT), `… còn ${values.length - EVIDENCE_LIMIT} bằng chứng`];
}

function check(
  id: ContractCheck['id'],
  status: ContractStatus,
  summary: string,
  evidence: string[] = []
): ContractCheck {
  return { id, status, summary, evidence: sample(evidence) };
}

function budgetCheck(
  id: ContractCheck['id'],
  label: string,
  evidence: string[],
  maximum: number,
  reliable: boolean
) {
  if (!reliable) {
    return check(id, 'unknown', `Không đủ bằng chứng để kiểm ngân sách ${label}.`, evidence);
  }
  const status: ContractStatus = evidence.length <= maximum ? 'pass' : 'fail';
  return check(id, status, `${label}: ${evidence.length} mới, ngân sách tối đa ${maximum}.`, evidence);
}

async function analyzeSnapshot(input: SourceFileInput[]): Promise<SnapshotAnalysis> {
  const files = canonicalFiles(input);
  const analyzable = files.filter((file) => JS_TS.test(file.path) && !TYPE_DECL.test(file.path));
  const unsupportedFiles = files.filter((file) => !JS_TS.test(file.path)).map((file) => file.path);

  const graph = await analyzeProject(analyzable);
  const health = importHealthReport(analyzable);
  const fileGraph = fileGraphReport(analyzable);
  const functions = new Set(graph.nodes.map((node) => node.id));
  const functionCycles = new Set(graph.nodes.filter((node) => node.inCycle).map((node) => node.id));
  const hotspots = new Set(graph.nodes.filter((node) => node.level !== 'ok').map((node) => node.id));
  const fileCycles = new Set(fileGraph.nodes.filter((node) => node.inCycle).map((node) => node.path));
  const unresolved = new Set(
    health.files.flatMap((file) => file.unresolvedImports.map((specifier) => `${file.path} -> ${specifier}`))
  );
  const parseErrors = health.files
    .filter((file) => file.verdict === 'parse-error')
    .map((file) => `${file.path}: ${file.error ?? 'lỗi cú pháp không xác định'}`);

  return {
    files,
    graph,
    health,
    fileCycles,
    functions,
    functionCycles,
    hotspots,
    unresolved,
    parseErrors,
    analyzableFiles: analyzable.length,
    unsupportedFiles,
    metrics: {
      files: health.summary.files,
      functions: graph.nodes.length,
      unresolvedImports: unresolved.size,
      filesInCycles: fileCycles.size,
      functionsInCycles: functionCycles.size,
      hotspots: hotspots.size
    }
  };
}

function fileChanges(before: SourceFileInput[], after: SourceFileInput[]) {
  const beforeByPath = new Map(before.map((file) => [file.path, file.content]));
  const afterByPath = new Map(after.map((file) => [file.path, file.content]));
  const beforePaths = new Set(beforeByPath.keys());
  const afterPaths = new Set(afterByPath.keys());
  return {
    added: difference(afterPaths, beforePaths),
    removed: difference(beforePaths, afterPaths),
    modified: [...afterPaths]
      .filter((path) => beforeByPath.has(path) && beforeByPath.get(path) !== afterByPath.get(path))
      .sort((a, b) => a.localeCompare(b))
  };
}

function overallStatus(checks: ContractCheck[]): ContractStatus {
  if (checks.some((item) => item.status === 'fail')) return 'fail';
  if (checks.some((item) => item.status === 'unknown')) return 'unknown';
  return 'pass';
}

export async function verifyChangeContract(
  beforeInput: SourceFileInput[],
  afterInput: SourceFileInput[],
  inputPolicy: ChangeContractPolicy = {}
): Promise<ChangeContractResult> {
  const policy = normalizeChangeContractPolicy(inputPolicy);
  const [before, after] = await Promise.all([analyzeSnapshot(beforeInput), analyzeSnapshot(afterInput)]);
  const complete =
    before.analyzableFiles > 0 &&
    after.analyzableFiles > 0 &&
    before.parseErrors.length === 0 &&
    after.parseErrors.length === 0;

  const files = fileChanges(before.files, after.files);
  const removedFunctions = difference(before.functions, after.functions);
  const addedFunctions = difference(after.functions, before.functions);
  const newUnresolved = difference(after.unresolved, before.unresolved);
  const resolvedUnresolved = difference(before.unresolved, after.unresolved);
  const filesEnteringCycles = difference(after.fileCycles, before.fileCycles);
  const functionsEnteringCycles = difference(after.functionCycles, before.functionCycles);
  const newHotspots = difference(after.hotspots, before.hotspots);

  const allowedFiles = new Set(policy.allow.removedFiles);
  const undeclaredRemovedFiles = files.removed.filter((path) => !allowedFiles.has(path));
  const allowedFunctions = new Set(policy.allow.removedFunctions);
  const undeclaredRemovedFunctions = removedFunctions.filter((id) => !allowedFunctions.has(id));
  const afterFiles = new Set(after.files.map((file) => file.path));
  const missingPreservedFiles = policy.preserve.files.filter((path) => !afterFiles.has(path));
  const missingPreservedFunctions = policy.preserve.functions.filter((id) => !after.functions.has(id));

  const analysisEvidence = [
    ...(before.analyzableFiles === 0 ? ['before: không có file JS/TS có thể phân tích'] : []),
    ...(after.analyzableFiles === 0 ? ['after: không có file JS/TS có thể phân tích'] : []),
    ...before.parseErrors.map((error) => `before: ${error}`),
    ...after.parseErrors.map((error) => `after: ${error}`)
  ];
  const checks: ContractCheck[] = [
    check(
      'analysis-complete',
      complete ? 'pass' : 'unknown',
      complete ? 'Hai snapshot JS/TS đã được phân tích đầy đủ.' : 'Analyzer không thể xác nhận đầy đủ hai snapshot.',
      analysisEvidence
    ),
    check(
      'removed-files-declared',
      undeclaredRemovedFiles.length === 0 ? 'pass' : 'fail',
      undeclaredRemovedFiles.length === 0
        ? `Mọi file bị xoá đều đã khai báo (${files.removed.length}).`
        : `${undeclaredRemovedFiles.length} file bị xoá ngoài allow-list.`,
      undeclaredRemovedFiles
    ),
    check(
      'removed-functions-declared',
      complete ? (undeclaredRemovedFunctions.length === 0 ? 'pass' : 'fail') : 'unknown',
      complete
        ? undeclaredRemovedFunctions.length === 0
          ? `Mọi hàm bị xoá đều đã khai báo (${removedFunctions.length}).`
          : `${undeclaredRemovedFunctions.length} hàm bị xoá ngoài allow-list.`
        : 'Không đủ bằng chứng để xác nhận danh sách hàm bị xoá.',
      undeclaredRemovedFunctions
    ),
    check(
      'preserved-files-exist',
      missingPreservedFiles.length === 0 ? 'pass' : 'fail',
      missingPreservedFiles.length === 0
        ? `Mọi file cần giữ vẫn tồn tại (${policy.preserve.files.length}).`
        : `${missingPreservedFiles.length} file cần giữ không còn tồn tại.`,
      missingPreservedFiles
    ),
    check(
      'preserved-functions-exist',
      complete ? (missingPreservedFunctions.length === 0 ? 'pass' : 'fail') : 'unknown',
      complete
        ? missingPreservedFunctions.length === 0
          ? `Mọi hàm cần giữ vẫn tồn tại (${policy.preserve.functions.length}).`
          : `${missingPreservedFunctions.length} hàm cần giữ không còn tồn tại.`
        : 'Không đủ bằng chứng để xác nhận các hàm cần giữ.',
      missingPreservedFunctions
    ),
    budgetCheck(
      'unresolved-import-budget',
      'import gãy',
      newUnresolved,
      policy.limits.maxNewUnresolvedImports,
      complete
    ),
    budgetCheck(
      'file-cycle-budget',
      'file mới rơi vào cycle',
      filesEnteringCycles,
      policy.limits.maxNewFilesInCycles,
      complete
    ),
    budgetCheck(
      'function-cycle-budget',
      'hàm mới rơi vào cycle',
      functionsEnteringCycles,
      policy.limits.maxNewFunctionsInCycles,
      complete
    ),
    budgetCheck('hotspot-budget', 'hotspot mới', newHotspots, policy.limits.maxNewHotspots, complete)
  ];

  const inputDigests = {
    before: filesDigest(before.files),
    after: filesDigest(after.files),
    policy: digest(JSON.stringify(policy))
  };
  const fingerprint = digest(JSON.stringify({ schemaVersion: 1, ...inputDigests }));
  const status = overallStatus(checks);
  const unsupported = uniqueSorted([...before.unsupportedFiles, ...after.unsupportedFiles]);
  const limitations = [
    'Chứng thư chỉ kiểm cấu trúc tĩnh; không chứng minh tương đương hành vi runtime.',
    'Hàm rename/move có ID mới và được xem là một hàm bị xoá cộng một hàm được thêm.'
  ];
  if (unsupported.length > 0) {
    limitations.push(
      `File ngoài JS/TS được đưa vào fingerprint và file diff nhưng không vào graph metrics: ${sample(unsupported).join(', ')}`
    );
  }

  return {
    schemaVersion: 1,
    status,
    accepted: status === 'pass',
    fingerprint,
    inputDigests,
    policy,
    changes: {
      files,
      functions: { added: addedFunctions, removed: removedFunctions },
      unresolvedImports: { added: newUnresolved, resolved: resolvedUnresolved },
      filesEnteringCycles,
      functionsEnteringCycles,
      newHotspots
    },
    metrics: { before: before.metrics, after: after.metrics },
    checks,
    limitations
  };
}
