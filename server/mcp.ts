// MCP server cho Huccanta — expose analyzer thành công cụ cho AI agent (Claude Code, v.v.)
// qua stdio. Tái dùng chính lõi phân tích của app (analyzeProject) và bộ quét thư mục (scan).
//
// Chạy: npm run mcp   (hoặc: npx tsx server/mcp.ts)
// Giao thức stdio dùng stdout để trao đổi — TUYỆT ĐỐI không console.log ra stdout ở đây;
// muốn log thì dùng console.error (stderr).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'node:path';
import { z } from 'zod';
import type { Graph, SourceFileInput } from '../src/types';
import { analyzeProject } from './analyze';
import { collectSourceFiles } from './scan';

// Cho phép "npx huccanta-mcp <folder>": nếu truyền thư mục, các tool có thể bỏ trống
// "path"/"files" và sẽ tự phân tích thư mục này.
const DEFAULT_ROOT = process.argv[2] ? path.resolve(process.argv[2]) : undefined;

const fileInput = z.object({
  path: z.string().describe('Đường dẫn file (tương đối), ví dụ "src/auth.ts".'),
  content: z.string().describe('Nội dung file.')
});

// Hai tool đều nhận cùng một cách chỉ định nguồn code: "path" (thư mục local) hoặc "files".
const sourceShape = {
  path: z
    .string()
    .optional()
    .describe('Đường dẫn thư mục local để quét đệ quy (JS/TS, Python, Java, Go, C/C++, C#; tự bỏ node_modules/dist/build...).'),
  files: z.array(fileInput).optional().describe('Danh sách file phân tích trực tiếp, dùng thay cho "path".')
};

async function loadFiles(input: { path?: string; files?: SourceFileInput[] }): Promise<SourceFileInput[]> {
  if (input.files && input.files.length > 0) return input.files;
  const root = input.path ?? DEFAULT_ROOT;
  if (root) {
    const files = await collectSourceFiles(root);
    if (files.length === 0) throw new Error(`Không tìm thấy file mã nguồn được hỗ trợ trong thư mục: ${root}`);
    return files;
  }
  throw new Error('Cần cung cấp "path" (thư mục local) hoặc "files".');
}

function overviewOf(graph: Graph) {
  return {
    functions: graph.nodes.length,
    calls: graph.edges.length,
    hotspots: graph.nodes.filter((n) => n.level === 'hot').length,
    watch: graph.nodes.filter((n) => n.level === 'warn').length,
    inCycle: graph.nodes.filter((n) => n.inCycle).length
  };
}

function rankedHotspots(graph: Graph, limit: number) {
  return graph.nodes
    .filter((node) => node.level !== 'ok')
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      name: node.name,
      file: node.file,
      line: node.line,
      level: node.level,
      complexity: node.complexity,
      fanIn: node.fanIn,
      fanOut: node.fanOut,
      inCycle: node.inCycle,
      issues: node.issues.map((issue) => issue.code)
    }));
}

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

const server = new McpServer({ name: 'huccanta', version: '0.2.0' });

server.registerTool(
  'analyze_code',
  {
    title: 'Analyze code flow',
    description:
      'Quét mã nguồn (JavaScript/TypeScript, Python, Java, Go, C/C++, C#...), dựng đồ thị lời gọi hàm ' +
      'và trả về tổng quan cùng danh sách điểm rối được xếp hạng (vòng gọi, độ phức tạp cao, fan-in/fan-out lớn). ' +
      'Cung cấp "path" (thư mục local) hoặc "files"; nếu server chạy kèm đường dẫn thư mục thì có thể bỏ trống cả hai.',
    inputSchema: {
      ...sourceShape,
      limit: z.number().int().positive().max(200).optional().describe('Số điểm rối tối đa trả về (mặc định 20).')
    }
  },
  async ({ path, files, limit }) => {
    const graph = await analyzeProject(await loadFiles({ path, files }));
    return json({ overview: overviewOf(graph), hotspots: rankedHotspots(graph, limit ?? 20) });
  }
);

server.registerTool(
  'get_function',
  {
    title: 'Get function detail',
    description:
      'Trả về code, danh sách hàm gọi đến (callers), hàm bị gọi (callees) và điểm rối của một hàm theo id ' +
      '(dạng "file#name"). Nhận cùng "path"/"files" như analyze_code.',
    inputSchema: {
      ...sourceShape,
      id: z.string().describe('Id hàm, ví dụ "src/auth.ts#login". Lấy từ kết quả analyze_code.')
    }
  },
  async ({ path, files, id }) => {
    const graph = await analyzeProject(await loadFiles({ path, files }));
    const node = graph.nodes.find((n) => n.id === id);
    if (!node) {
      const sample = graph.nodes.map((n) => n.id).slice(0, 50);
      return {
        content: [{ type: 'text' as const, text: `Không tìm thấy hàm "${id}".\nMột số id có sẵn:\n${sample.join('\n')}` }],
        isError: true
      };
    }
    return json({
      id: node.id,
      name: node.name,
      file: node.file,
      line: node.line,
      level: node.level,
      complexity: node.complexity,
      fanIn: node.fanIn,
      fanOut: node.fanOut,
      inCycle: node.inCycle,
      issues: node.issues,
      callers: graph.edges.filter((e) => e.to === id).map((e) => e.from),
      callees: graph.edges.filter((e) => e.from === id).map((e) => e.to),
      code: node.code
    });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`Huccanta MCP server ready (stdio).${DEFAULT_ROOT ? ` Root mặc định: ${DEFAULT_ROOT}` : ''}`);
