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
