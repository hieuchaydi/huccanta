export type NodeLevel = 'ok' | 'warn' | 'hot';
export type EdgeKind = 'call' | 'async' | 'recursive';
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
