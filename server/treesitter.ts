// Parser đa ngôn ngữ bằng tree-sitter (WASM) cho các ngôn ngữ ngoài JS/TS.
// JS/TS vẫn do ts-morph xử lý (chính xác hơn nhờ resolve symbol); ở đây là Python/Java/Go/C/C++/C#...
//
// Đầu ra là `Graph` CHƯA chấm điểm — dùng chung `analyzeGraph` (SCC/complexity/fan-in-out) để tính.
// Lưu ý: tree-sitter không resolve symbol như ts-morph, nên lời gọi được khớp THEO TÊN
// (ưu tiên cùng file, hoặc khi tên là duy nhất toàn dự án). Đây là heuristic, kém chính xác hơn JS/TS.
import Parser from 'web-tree-sitter';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Graph, GraphEdge, GraphNode, SourceFileInput } from '../src/types';

const require = createRequire(import.meta.url);
const WASM_DIR = path.join(path.dirname(require.resolve('tree-sitter-wasms/package.json')), 'out');

interface LangConfig {
  grammar: string;        // tên file grammar: tree-sitter-<grammar>.wasm
  extensions: string[];   // đuôi file (không dấu chấm, chữ thường)
  defTypes: string[];     // node type là định nghĩa hàm/method
  nameQuery: string;      // query bắt @def (node định nghĩa) + @name (tên)
  callQuery: string;      // query bắt @c (tên hàm được gọi)
  classTypes: string[];   // node type bao ngoài để tạo tiền tố "Class.method"
}

const CONFIGS: LangConfig[] = [
  {
    grammar: 'python',
    extensions: ['py', 'pyi'],
    defTypes: ['function_definition'],
    nameQuery: '(function_definition name: (identifier) @name) @def',
    callQuery: '(call function: [(identifier) @c (attribute attribute: (identifier) @c)])',
    classTypes: ['class_definition']
  },
  {
    grammar: 'java',
    extensions: ['java'],
    defTypes: ['method_declaration', 'constructor_declaration'],
    nameQuery:
      '[(method_declaration name: (identifier) @name) (constructor_declaration name: (identifier) @name)] @def',
    callQuery: '(method_invocation name: (identifier) @c)',
    classTypes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration']
  },
  {
    grammar: 'go',
    extensions: ['go'],
    defTypes: ['function_declaration', 'method_declaration'],
    nameQuery:
      '[(function_declaration name: (identifier) @name) (method_declaration name: (field_identifier) @name)] @def',
    callQuery:
      '(call_expression function: [(identifier) @c (selector_expression field: (field_identifier) @c)])',
    classTypes: []
  },
  {
    grammar: 'c',
    extensions: ['c', 'h'],
    defTypes: ['function_definition'],
    nameQuery: '(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def',
    callQuery: '(call_expression function: (identifier) @c)',
    classTypes: []
  },
  {
    grammar: 'cpp',
    extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
    defTypes: ['function_definition'],
    nameQuery:
      '(function_definition declarator: (function_declarator declarator: [(identifier) @name (field_identifier) @name (qualified_identifier) @name])) @def',
    callQuery:
      '(call_expression function: [(identifier) @c (field_expression field: (field_identifier) @c)])',
    classTypes: ['class_specifier', 'struct_specifier']
  },
  {
    grammar: 'c_sharp',
    extensions: ['cs'],
    defTypes: ['method_declaration', 'constructor_declaration', 'local_function_statement'],
    nameQuery:
      '[(method_declaration name: (identifier) @name) (constructor_declaration name: (identifier) @name) (local_function_statement name: (identifier) @name)] @def',
    callQuery:
      '(invocation_expression function: [(identifier) @c (member_access_expression name: (identifier) @c)])',
    classTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration']
  }
];

const EXT_TO_CONFIG = new Map<string, LangConfig>();
for (const config of CONFIGS) for (const ext of config.extensions) EXT_TO_CONFIG.set(ext, config);

/** Các đuôi file mà tree-sitter (không phải ts-morph) đảm nhiệm. */
export const TREE_SITTER_EXTENSIONS = [...EXT_TO_CONFIG.keys()];

export function treeSitterHandles(filePath: string) {
  return EXT_TO_CONFIG.has(extOf(filePath));
}

function extOf(filePath: string) {
  const dot = filePath.lastIndexOf('.');
  return dot === -1 ? '' : filePath.slice(dot + 1).toLowerCase();
}

// Node điều kiện tính vào độ phức tạp — heuristic khớp nhiều ngôn ngữ theo tên node type.
const BRANCH_RE = /(?:^|_)(if|elif|for|foreach|while|do|case|when|catch|except|conditional|ternary)(?:_|$)/;

// Các object WASM (Parser/Language/Query) không được JS GC thu hồi → phải tái dùng,
// không tạo mới mỗi lần (nếu không sẽ rò rỉ heap WASM khi MCP server chạy dài).
let initPromise: Promise<void> | null = null;
let sharedParser: Parser | null = null;
const languageCache = new Map<string, Parser.Language>();
const queryCache = new Map<string, { defQuery: Parser.Query; callQuery: Parser.Query }>();

async function ensureParser(): Promise<Parser> {
  initPromise ??= Parser.init();
  await initPromise;
  sharedParser ??= new Parser();
  return sharedParser;
}

async function loadLanguage(config: LangConfig): Promise<Parser.Language> {
  await ensureParser();
  let language = languageCache.get(config.grammar);
  if (!language) {
    language = await Parser.Language.load(path.join(WASM_DIR, `tree-sitter-${config.grammar}.wasm`));
    languageCache.set(config.grammar, language);
  }
  return language;
}

// Biên dịch query một lần cho mỗi ngôn ngữ rồi tái dùng (query gắn với Language, dùng lại được).
function getQueries(config: LangConfig, language: Parser.Language) {
  let queries = queryCache.get(config.grammar);
  if (!queries) {
    queries = { defQuery: language.query(config.nameQuery), callQuery: language.query(config.callQuery) };
    queryCache.set(config.grammar, queries);
  }
  return queries;
}

interface DefRecord {
  node: GraphNode;
  calleeNames: string[];
}

function uniqueId(base: string, used: Set<string>, line: number) {
  if (!used.has(base)) return add(base, used);
  const withLine = `${base}@${line}`;
  if (!used.has(withLine)) return add(withLine, used);
  let i = 2;
  while (used.has(`${withLine}-${i}`)) i += 1;
  return add(`${withLine}-${i}`, used);
}
function add(id: string, used: Set<string>) {
  used.add(id);
  return id;
}

function enclosingClassName(node: Parser.SyntaxNode, classTypes: string[]): string {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (classTypes.includes(current.type)) {
      const name = current.childForFieldName('name');
      if (name) return name.text;
    }
    current = current.parent;
  }
  return '';
}

function nearestDefStart(node: Parser.SyntaxNode, defTypes: string[]): number | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (defTypes.includes(current.type)) return current.startIndex;
    current = current.parent;
  }
  return null;
}

function complexityOf(defNode: Parser.SyntaxNode, defTypes: string[]) {
  let complexity = 1;
  const stack = [...defNode.namedChildren];
  while (stack.length) {
    const node = stack.pop()!;
    if (defTypes.includes(node.type)) continue; // hàm con là đơn vị riêng — không tính vào hàm ngoài
    if (BRANCH_RE.test(node.type)) complexity += 1;
    for (const child of node.namedChildren) stack.push(child);
  }
  return complexity;
}

export async function parseTreeSitter(files: SourceFileInput[]): Promise<Graph> {
  const byConfig = new Map<LangConfig, SourceFileInput[]>();
  for (const file of files) {
    const config = EXT_TO_CONFIG.get(extOf(file.path));
    if (!config) continue;
    const list = byConfig.get(config) ?? [];
    list.push(file);
    byConfig.set(config, list);
  }
  if (byConfig.size === 0) return { nodes: [], edges: [] };

  const records: DefRecord[] = [];
  const usedIds = new Set<string>();
  const nameToIds = new Map<string, string[]>();
  const parser = await ensureParser();

  for (const [config, configFiles] of byConfig) {
    let language: Parser.Language;
    let defQuery: Parser.Query;
    let callQuery: Parser.Query;
    try {
      language = await loadLanguage(config);
      parser.setLanguage(language);
      ({ defQuery, callQuery } = getQueries(config, language));
    } catch (error) {
      // Một ngôn ngữ lỗi (grammar/query) không được làm hỏng cả lần phân tích.
      console.error(`[treesitter] bỏ qua ${config.grammar}:`, error instanceof Error ? error.message : error);
      continue;
    }

    for (const file of configFiles) {
      const tree = parser.parse(file.content);
      const startToId = new Map<number, DefRecord>();

      for (const match of defQuery.matches(tree.rootNode)) {
        const defNode = match.captures.find((c) => c.name === 'def')?.node;
        const nameNode = match.captures.find((c) => c.name === 'name')?.node;
        if (!defNode || !nameNode) continue;
        const bare = nameNode.text; // tên trần dùng để khớp lời gọi (call site cũng là tên trần)
        const prefix = config.classTypes.length ? enclosingClassName(defNode, config.classTypes) : '';
        const display = prefix ? `${prefix}.${bare}` : bare;
        const line = nameNode.startPosition.row + 1;
        const id = uniqueId(`${file.path}#${display}`, usedIds, line);
        const record: DefRecord = {
          calleeNames: [],
          node: {
            id,
            name: display,
            file: file.path,
            line,
            code: defNode.text,
            body: defNode.text,
            complexity: complexityOf(defNode, config.defTypes),
            fanIn: 0,
            fanOut: 0,
            inCycle: false,
            issues: [],
            level: 'ok',
            score: 0
          }
        };
        records.push(record);
        startToId.set(defNode.startIndex, record);
        const list = nameToIds.get(bare) ?? [];
        list.push(id);
        nameToIds.set(bare, list);
      }

      // Gán mỗi lời gọi cho hàm bao gần nhất (đúng cả khi lồng nhau).
      for (const capture of callQuery.captures(tree.rootNode)) {
        const start = nearestDefStart(capture.node, config.defTypes);
        if (start === null) continue;
        startToId.get(start)?.calleeNames.push(capture.node.text);
      }

      tree.delete();
    }
  }

  const edges = new Map<string, GraphEdge>();
  for (const record of records) {
    const fromFile = record.node.file;
    for (const name of record.calleeNames) {
      const candidates = nameToIds.get(name) ?? [];
      let target: string | undefined;
      if (candidates.length === 1) target = candidates[0];
      else if (candidates.length > 1) target = candidates.find((id) => id.startsWith(`${fromFile}#`));
      if (!target) continue; // không rõ đích (tên trùng nhiều nơi) → bỏ, tránh vẽ cạnh sai
      const key = `${record.node.id}>${target}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        continue;
      }
      edges.set(key, {
        from: record.node.id,
        to: target,
        cycle: false,
        kind: record.node.id === target ? 'recursive' : 'call',
        count: 1
      });
    }
  }

  return { nodes: records.map((r) => r.node), edges: [...edges.values()] };
}
