// Điểm vào phân tích đa ngôn ngữ. Chia file theo ngôn ngữ:
//   - JS/TS  → ts-morph (parseSources, chính xác nhờ resolve symbol)
//   - còn lại → tree-sitter (parseTreeSitter, resolver AST bảo thủ theo owner/scope)
// rồi gộp thành một đồ thị và chấm điểm chung bằng analyzeGraph.
import { createHash } from 'node:crypto';
import { analyzeGraph, parseSources } from '../src/analyzer';
import type { Graph, SourceFileInput } from '../src/types';
import { parseTreeSitter, treeSitterHandles } from './treesitter';

const JS_TS = /\.(cjs|mjs|js|jsx|ts|tsx|mts|cts)$/i;

// Cache kết quả theo chữ ký nội dung — agent thường gọi analyze_code rồi get_function
// nhiều lần trên cùng project, không nên parse lại toàn bộ mỗi lần. Giữ tối đa vài bộ gần nhất.
const CACHE_MAX = 8;
const cache = new Map<string, Graph>();

function signatureOf(files: SourceFileInput[]): string {
  const hash = createHash('sha1');
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    hash.update(file.path);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export async function analyzeProject(files: SourceFileInput[]): Promise<Graph> {
  const key = signatureOf(files);
  const cached = cache.get(key);
  if (cached) return cached;

  const jsFiles = files.filter((file) => JS_TS.test(file.path));
  const otherFiles = files.filter((file) => !JS_TS.test(file.path) && treeSitterHandles(file.path));

  const jsGraph = jsFiles.length > 0 ? parseSources(jsFiles) : { nodes: [], edges: [] };
  const otherGraph = otherFiles.length > 0 ? await parseTreeSitter(otherFiles) : { nodes: [], edges: [] };

  // Id là "file#name" nên hai nhóm không đụng nhau (đuôi file khác nhau).
  const merged: Graph = {
    nodes: [...jsGraph.nodes, ...otherGraph.nodes],
    edges: [...jsGraph.edges, ...otherGraph.edges]
  };
  const graph = analyzeGraph(merged);

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, graph);
  return graph;
}
