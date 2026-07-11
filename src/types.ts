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
