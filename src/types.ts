export type NodeLevel = 'ok' | 'warn' | 'hot';
export type EdgeKind = 'call' | 'async' | 'recursive';
export type EdgeResolution = 'exact' | 'same-file';
export type FixKind = 'tangle' | 'warn' | 'accent';
export type IssueCode = 'cycle' | 'complexity' | 'fanOut' | 'fanIn';

// Điểm rối ở dạng mã hoá (code + số) để client tự dịch ra ngôn ngữ đang chọn.
export interface Issue {
  code: IssueCode;
  value?: number;
  fix: FixKind;
}

export interface GraphNode {
  id: string;
  name: string;
  file: string;
  line: number;
  code: string;
  body: string;
  complexity: number;
  fanIn: number;
  fanOut: number;
  inCycle: boolean;
  issues: Issue[];
  level: NodeLevel;
  score: number;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  cycle: boolean;
  kind?: EdgeKind;
  count?: number;
  /** Cách resolver tĩnh xác định đích; không phải runtime proof. */
  resolution?: EdgeResolution;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SourceFileInput {
  path: string;
  content: string;
}

// ---- GĐ 1: Import Health Report (mức file, dựa trên import/export thật) ----
export type FileVerdict = 'ok' | 'entry' | 'possibly-unused' | 'parse-error';

export interface FileHealth {
  path: string;
  verdict: FileVerdict;
  imports: number; // số import phân giải được tới file khác trong project (outbound)
  importedBy: number; // số file import file này (inbound)
  exports: number; // số symbol được export
  unresolvedImports: string[]; // import tương đối trỏ tới file không tồn tại (gãy)
  confidence?: number; // chỉ cho 'possibly-unused' (0–100)
  evidence: string[]; // bằng chứng cho kết luận
  entryReason?: string; // vì sao coi là entry (nếu verdict = 'entry')
  error?: string; // thông báo lỗi (nếu verdict = 'parse-error')
}

export interface ImportHealthReport {
  summary: {
    files: number;
    entryPoints: number;
    possiblyUnused: number;
    parseErrors: number;
    unresolvedImports: number;
  };
  files: FileHealth[];
}

// ---- GĐ 2: Đồ thị mức file (dựa trên import/export thật, chỉ JS/TS) ----
export type FileNodeKind = 'entry' | 'normal' | 'orphan';
// orphan = không ai import & không phải entry (đồng bộ với 'possibly-unused' của Import Health)

export interface FileGraphNode {
  id: string; // = path đã normalize (vd "src/auth.ts"). Ổn định, khớp FileHealth.path.
  path: string; // = id (giữ cả hai cho tiện đọc phía UI)
  label: string; // tên hiển thị ngắn: basename, hoặc "dir/basename" nếu trùng basename
  kind: FileNodeKind;
  imports: number; // outbound: số file khác file này import (dedup)
  importedBy: number; // inbound: số file import file này
  exports: number; // số symbol export
  loc: number; // số dòng (đếm '\n' + 1) — để ước lượng "kích thước" node
  inCycle: boolean; // nằm trong vòng phụ thuộc file (import cycle)
  unresolved: number; // số import tương đối gãy (từ file này)
}

export interface FileGraphEdge {
  from: string; // id file import
  to: string; // id file bị import
  cycle: boolean; // cạnh nằm trong một vòng phụ thuộc (SCC)
}

export interface FileGraph {
  nodes: FileGraphNode[];
  edges: FileGraphEdge[];
  summary: {
    files: number;
    edges: number;
    cycles: number; // số SCC có kích thước > 1 (hoặc self-loop)
    filesInCycle: number; // số file thuộc một vòng phụ thuộc
    entries: number;
    orphans: number;
    unresolvedImports: number;
  };
}

// ---- Refactor Sandbox: giả lập một thay đổi trên "đồ thị bóng", không đụng filesystem ----
export type ChangeKind = 'delete-file' | 'delete-function';

export interface SimChange {
  kind: ChangeKind;
  target: string; // đường dẫn file (delete-file) hoặc id hàm "file#name" (delete-function)
}

export interface AffectedCaller {
  id: string;
  file: string;
  removedCallees: string[]; // các hàm bị xoá mà nơi này đang gọi (lời gọi sẽ gãy)
  fanOutBefore: number;
  fanOutAfter: number;
}

export interface SimulationResult {
  change: SimChange;
  found: boolean; // target có tồn tại không
  removed: { functions: number; files: string[] };
  brokenCallers: AffectedCaller[]; // nơi gọi tới hàm bị xoá → lời gọi gãy
  newlyOrphaned: { id: string; file: string }[]; // hàm mất hết nơi gọi sau thay đổi
  affectedTests: string[]; // file test có liên quan
  metrics: {
    functions: { before: number; after: number };
    functionsInCycle: { before: number; after: number };
    hotspots: { before: number; after: number };
  };
  summary: string[]; // tóm tắt dễ đọc (blast radius + delta)
}

// ---- Change Contract: xác minh snapshot trước/sau theo ý định thay đổi đã khai báo ----
export type ContractStatus = 'pass' | 'fail' | 'unknown';

export interface ChangeContractPolicy {
  name?: string;
  allow?: {
    removedFiles?: string[];
    removedFunctions?: string[];
  };
  preserve?: {
    files?: string[];
    functions?: string[];
  };
  limits?: {
    maxNewUnresolvedImports?: number;
    maxNewFilesInCycles?: number;
    maxNewFunctionsInCycles?: number;
    maxNewHotspots?: number;
  };
}

export interface NormalizedChangeContractPolicy {
  name: string;
  allow: {
    removedFiles: string[];
    removedFunctions: string[];
  };
  preserve: {
    files: string[];
    functions: string[];
  };
  limits: {
    maxNewUnresolvedImports: number;
    maxNewFilesInCycles: number;
    maxNewFunctionsInCycles: number;
    maxNewHotspots: number;
  };
}

export type ContractCheckId =
  | 'analysis-complete'
  | 'removed-files-declared'
  | 'removed-functions-declared'
  | 'preserved-files-exist'
  | 'preserved-functions-exist'
  | 'unresolved-import-budget'
  | 'file-cycle-budget'
  | 'function-cycle-budget'
  | 'hotspot-budget';

export interface ContractCheck {
  id: ContractCheckId;
  status: ContractStatus;
  summary: string;
  evidence: string[];
}

export interface ContractMetrics {
  files: number;
  functions: number;
  unresolvedImports: number;
  filesInCycles: number;
  functionsInCycles: number;
  hotspots: number;
}

export interface ChangeContractResult {
  schemaVersion: 1;
  status: ContractStatus;
  accepted: boolean;
  fingerprint: string;
  inputDigests: {
    before: string;
    after: string;
    policy: string;
  };
  policy: NormalizedChangeContractPolicy;
  changes: {
    files: {
      added: string[];
      removed: string[];
      modified: string[];
    };
    functions: {
      added: string[];
      removed: string[];
    };
    unresolvedImports: {
      added: string[];
      resolved: string[];
    };
    filesEnteringCycles: string[];
    functionsEnteringCycles: string[];
    newHotspots: string[];
  };
  metrics: {
    before: ContractMetrics;
    after: ContractMetrics;
  };
  checks: ContractCheck[];
  limitations: string[];
}

// ---- Contract Radar: nối HTTP client calls với backend routes từ source thật ----
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ANY';
export type ContractConfidence = 'exact' | 'pattern';
export type HttpContractFramework = 'fetch' | 'axios' | 'express' | 'fastify' | 'nest' | 'next';
export type HttpContractAuth = 'present' | 'required' | 'absent' | 'unknown';

export interface HttpContractDetails {
  requestFields: string[];
  responseFields: string[];
  auth: HttpContractAuth;
  statuses: number[];
}

export interface HttpContractEndpoint {
  id: string;
  side: 'client' | 'server';
  method: HttpMethod;
  path: string;
  file: string;
  line: number;
  framework: HttpContractFramework;
  confidence: ContractConfidence;
  contract: HttpContractDetails;
  coveredBy: string[];
}

export interface HttpContractObservation {
  id: string;
  method: Exclude<HttpMethod, 'ANY'>;
  path: string;
  file: string;
  line: number;
  source: 'test';
}

export interface HttpContractIssue {
  kind:
    | 'missing-route'
    | 'method-mismatch'
    | 'request-schema-mismatch'
    | 'response-schema-mismatch'
    | 'missing-auth'
    | 'status-mismatch'
    | 'route-without-test'
    | 'no-local-consumer';
  severity: 'error' | 'warning' | 'info';
  endpointId: string;
  message: string;
  candidates: string[];
}

export interface ContractUnknown {
  side: 'client' | 'server';
  file: string;
  line: number;
  expression: string;
  reason: string;
}

export interface ContractRadarReport {
  summary: {
    clientCalls: number;
    serverRoutes: number;
    matches: number;
    missingRoutes: number;
    methodMismatches: number;
    requestSchemaMismatches: number;
    responseSchemaMismatches: number;
    missingAuth: number;
    statusMismatches: number;
    routesWithTests: number;
    routesWithoutTests: number;
    noLocalConsumers: number;
    unknowns: number;
  };
  clients: HttpContractEndpoint[];
  routes: HttpContractEndpoint[];
  observations: HttpContractObservation[];
  matches: { clientId: string; routeId: string }[];
  issues: HttpContractIssue[];
  unknowns: ContractUnknown[];
  limitations: string[];
}
