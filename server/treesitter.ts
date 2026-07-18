// Parser đa ngôn ngữ bằng tree-sitter (WASM) cho các ngôn ngữ ngoài JS/TS.
// JS/TS vẫn do ts-morph xử lý; nhóm này dùng AST + resolver tĩnh bảo thủ theo owner/scope.
//
// Đầu ra là `Graph` CHƯA chấm điểm — dùng chung `analyzeGraph` (SCC/complexity/fan-in-out) để tính.
// Tree-sitter không có type checker, nên resolver không cố đoán: chỉ nối cạnh khi đích là
// qualified symbol rõ ràng hoặc symbol duy nhất trong cùng file; không nối theo tên trần xuyên file.
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
  callQuery: string;      // query bắt @call (lời gọi) + @c (tên hàm được gọi)
  classTypes: string[];   // node type bao ngoài để tạo tiền tố "Class.method"
  branchTypes: string[];  // node type nhánh rẽ của grammar, dùng tính complexity
}

const CONFIGS: LangConfig[] = [
  {
    grammar: 'python',
    extensions: ['py', 'pyi'],
    defTypes: ['function_definition'],
    nameQuery: '(function_definition name: (identifier) @name) @def',
    callQuery: '(call function: [(identifier) @c (attribute attribute: (identifier) @c)]) @call',
    classTypes: ['class_definition'],
    branchTypes: [
      'if_statement',
      'elif_clause',
      'if_clause',
      'for_statement',
      'for_in_clause',
      'while_statement',
      'except_clause',
      'case_clause',
      'conditional_expression',
      'boolean_operator'
    ]
  },
  {
    grammar: 'java',
    extensions: ['java'],
    defTypes: ['method_declaration', 'constructor_declaration'],
    nameQuery:
      '[(method_declaration name: (identifier) @name) (constructor_declaration name: (identifier) @name)] @def',
    callQuery: '(method_invocation name: (identifier) @c) @call',
    classTypes: ['class_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration'],
    branchTypes: [
      'if_statement',
      'for_statement',
      'enhanced_for_statement',
      'while_statement',
      'do_statement',
      'switch_block_statement_group',
      'catch_clause',
      'conditional_expression'
    ]
  },
  {
    grammar: 'go',
    extensions: ['go'],
    defTypes: ['function_declaration', 'method_declaration'],
    nameQuery:
      '[(function_declaration name: (identifier) @name) (method_declaration name: (field_identifier) @name)] @def',
    callQuery:
      '(call_expression function: [(identifier) @c (selector_expression field: (field_identifier) @c)]) @call',
    classTypes: [],
    branchTypes: [
      'if_statement',
      'for_statement',
      'communication_case',
      'expression_case',
      'type_case'
    ]
  },
  {
    grammar: 'c',
    extensions: ['c', 'h'],
    defTypes: ['function_definition'],
    nameQuery: '(function_definition declarator: (function_declarator declarator: (identifier) @name)) @def',
    callQuery: '(call_expression function: (identifier) @c) @call',
    classTypes: [],
    branchTypes: ['if_statement', 'for_statement', 'while_statement', 'do_statement', 'case_statement', 'conditional_expression']
  },
  {
    grammar: 'cpp',
    extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
    defTypes: ['function_definition'],
    nameQuery:
      '(function_definition declarator: (function_declarator declarator: [(identifier) @name (field_identifier) @name (qualified_identifier) @name])) @def',
    callQuery:
      '(call_expression function: [(identifier) @c (field_expression field: (field_identifier) @c)]) @call',
    classTypes: ['class_specifier', 'struct_specifier'],
    branchTypes: ['if_statement', 'for_statement', 'while_statement', 'do_statement', 'case_statement', 'conditional_expression', 'catch_clause']
  },
  {
    grammar: 'c_sharp',
    extensions: ['cs'],
    defTypes: ['method_declaration', 'constructor_declaration', 'local_function_statement'],
    nameQuery:
      '[(method_declaration name: (identifier) @name) (constructor_declaration name: (identifier) @name) (local_function_statement name: (identifier) @name)] @def',
    callQuery:
      '(invocation_expression function: [(identifier) @c (member_access_expression name: (identifier) @c)]) @call',
    classTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration'],
    branchTypes: [
      'if_statement',
      'for_statement',
      'for_each_statement',
      'while_statement',
      'do_statement',
      'case_switch_label',
      'default_switch_label',
      'catch_clause',
      'conditional_expression'
    ]
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
  grammar: string;
  ownerName: string;
  selfReceiver: string;
  moduleNames: string[];
  moduleQualifiedName: string;
  calls: CallRecord[];
}

interface CallRecord {
  name: string;
  receiver: string;
  explicitReceiver: boolean;
}

interface PythonModuleInfo {
  primary: string;
  aliases: string[];
  isPackage: boolean;
}

interface PythonImportedBinding {
  module: string;
  symbol: string;
}

interface PythonScope {
  modules: Map<string, string>;
  imported: Map<string, PythonImportedBinding>;
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

function enclosingOwner(node: Parser.SyntaxNode, config: LangConfig) {
  const className = config.classTypes.length ? enclosingClassName(node, config.classTypes) : '';
  if (className) return { name: className, selfReceiver: '' };
  // Go không có class node; method receiver vẫn là owner tĩnh (S.Method).
  if (config.grammar === 'go' && node.type === 'method_declaration') {
    const receiver = node.childForFieldName('receiver');
    const stack = receiver ? [receiver] : [];
    while (stack.length) {
      const current = stack.pop()!;
      const typeNode = current.childForFieldName('type');
      if (typeNode) {
        const typeName = typeNode.text.match(/[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? '';
        const receiverName = current.childForFieldName('name')?.text ?? '';
        return { name: typeName, selfReceiver: receiverName };
      }
      for (const child of current.namedChildren) stack.push(child);
    }
  }
  return { name: '', selfReceiver: '' };
}

function nearestDefStart(node: Parser.SyntaxNode, defTypes: string[]): number | null {
  let current: Parser.SyntaxNode | null = node.parent;
  while (current) {
    if (defTypes.includes(current.type)) return current.startIndex;
    current = current.parent;
  }
  return null;
}

function complexityOf(defNode: Parser.SyntaxNode, defTypes: string[], branchTypes: string[]) {
  let complexity = 1;
  const stack = [...defNode.namedChildren];
  while (stack.length) {
    const node = stack.pop()!;
    if (defTypes.includes(node.type)) continue; // hàm con là đơn vị riêng — không tính vào hàm ngoài
    if (branchTypes.includes(node.type)) complexity += 1;
    for (const child of node.namedChildren) stack.push(child);
  }
  return complexity;
}

function functionNode(callNode: Parser.SyntaxNode) {
  return callNode.childForFieldName('function') ?? callNode.childForFieldName('name');
}

function callParts(callNode: Parser.SyntaxNode, nameNode: Parser.SyntaxNode): CallRecord {
  const fn = functionNode(callNode);
  const receiverNode =
    fn?.childForFieldName('object') ??
    fn?.childForFieldName('operand') ??
    fn?.childForFieldName('expression') ??
    fn?.childForFieldName('argument') ??
    callNode.childForFieldName('object');
  const functionWrapsName = Boolean(
    fn && (fn.startIndex !== nameNode.startIndex || fn.endIndex !== nameNode.endIndex)
  );
  return {
    name: nameNode.text,
    receiver: receiverNode?.text.trim() ?? '',
    explicitReceiver: Boolean(receiverNode) || functionWrapsName
  };
}

function normalizeQualified(value: string) {
  return value.replace(/\s+/g, '').replace(/::|->/g, '.').replace(/^this\./, '').replace(/^self\./, '');
}

function normalizeSourcePath(value: string) {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
}

function withoutPythonExtension(value: string) {
  return value.replace(/\.(?:py|pyi)$/i, '');
}

function pythonModuleInfos(files: SourceFileInput[]) {
  const normalized = files.map((file) => normalizeSourcePath(file.path));
  const packageDirs = new Set(
    normalized
      .filter((filePath) => /(?:^|\/)__init__\.(?:py|pyi)$/i.test(filePath))
      .map((filePath) => filePath.replace(/\/__init__\.(?:py|pyi)$/i, ''))
      .filter(Boolean)
  );
  const result = new Map<string, PythonModuleInfo>();

  for (const file of files) {
    const normalizedPath = normalizeSourcePath(file.path);
    const rawParts = withoutPythonExtension(normalizedPath).split('/').filter(Boolean);
    const isPackage = rawParts.at(-1) === '__init__';
    const pathParts = isPackage ? rawParts.slice(0, -1) : rawParts;
    const directories = isPackage ? pathParts : pathParts.slice(0, -1);
    let packageStart = directories.length;
    while (packageStart > 0 && packageDirs.has(directories.slice(0, packageStart).join('/'))) {
      packageStart -= 1;
    }
    const full = pathParts.join('.');
    const packageRelative = [
      ...directories.slice(packageStart),
      ...(isPackage ? [] : pathParts.slice(-1))
    ].join('.');
    const primary = packageRelative || full;
    const aliases = [...new Set([primary, full].filter(Boolean))];
    result.set(file.path, { primary, aliases, isPackage });
  }
  return result;
}

function pythonFromModule(rawModule: string, current: PythonModuleInfo): string | undefined {
  const dots = rawModule.match(/^\.+/)?.[0].length ?? 0;
  if (dots === 0) return normalizeQualified(rawModule);
  const currentPackage = current.isPackage
    ? current.primary.split('.').filter(Boolean)
    : current.primary.split('.').filter(Boolean).slice(0, -1);
  const ascend = dots - 1;
  if (ascend > currentPackage.length) return undefined;
  const suffix = rawModule.slice(dots).split('.').filter(Boolean);
  return [...currentPackage.slice(0, currentPackage.length - ascend), ...suffix].join('.');
}

function importNameParts(node: Parser.SyntaxNode) {
  if (node.type === 'aliased_import') {
    return {
      name: node.childForFieldName('name')?.text.trim() ?? '',
      alias: node.childForFieldName('alias')?.text.trim() ?? ''
    };
  }
  return { name: node.text.trim(), alias: '' };
}

function pythonScope(root: Parser.SyntaxNode, moduleInfo: PythonModuleInfo): PythonScope {
  const scope: PythonScope = { modules: new Map(), imported: new Map() };
  // Chỉ nhận import ở module scope. Import trong function/branch có lifetime khác và không được đoán.
  for (const statement of root.namedChildren) {
    if (statement.type === 'import_statement') {
      for (const item of statement.namedChildren) {
        const { name, alias } = importNameParts(item);
        if (!name) continue;
        const local = alias || name.split('.')[0];
        const target = alias ? normalizeQualified(name) : normalizeQualified(name.split('.')[0]);
        if (local && target) scope.modules.set(local, target);
      }
      continue;
    }
    if (statement.type !== 'import_from_statement') continue;
    const moduleNode = statement.childForFieldName('module_name');
    if (!moduleNode) continue;
    const importedFrom = pythonFromModule(moduleNode.text.trim(), moduleInfo);
    if (importedFrom === undefined) continue;
    for (const item of statement.namedChildren) {
      if (item.startIndex === moduleNode.startIndex && item.endIndex === moduleNode.endIndex) continue;
      if (item.type === 'wildcard_import') continue;
      const { name, alias } = importNameParts(item);
      if (!name) continue;
      scope.imported.set(alias || name, { module: importedFrom, symbol: normalizeQualified(name) });
    }
  }
  return scope;
}

function moduleKey(moduleName: string, qualifiedName: string) {
  return `${normalizeQualified(moduleName)}\0${normalizeQualified(qualifiedName)}`;
}

function uniqueRecords(records: DefRecord[]) {
  return [...new Map(records.map((record) => [record.node.id, record])).values()];
}

function moduleTargets(
  moduleNames: string[],
  qualifiedName: string,
  byModuleQualified: Map<string, DefRecord[]>
) {
  return uniqueRecords(moduleNames.flatMap((moduleName) =>
    byModuleQualified.get(moduleKey(moduleName, qualifiedName)) ?? []
  ));
}

function mappedReceiverTargets(
  mappedReceiver: string,
  calledName: string,
  byModuleQualified: Map<string, DefRecord[]>
) {
  const parts = normalizeQualified(mappedReceiver).split('.').filter(Boolean);
  const candidates: DefRecord[] = [];
  for (let split = parts.length; split > 0; split -= 1) {
    const moduleName = parts.slice(0, split).join('.');
    const owner = parts.slice(split).join('.');
    const qualified = owner ? `${owner}.${calledName}` : calledName;
    candidates.push(...(byModuleQualified.get(moduleKey(moduleName, qualified)) ?? []));
  }
  return uniqueRecords(candidates);
}

function pythonCallTarget(
  record: DefRecord,
  call: CallRecord,
  scope: PythonScope | undefined,
  byModuleQualified: Map<string, DefRecord[]>
) {
  const name = normalizeQualified(call.name);
  const receiver = normalizeQualified(call.receiver);
  const owner = normalizeQualified(record.ownerName);

  if (call.explicitReceiver && receiver === 'self' && owner) {
    const selfTarget = moduleTargets(record.moduleNames, `${owner}.${name}`, byModuleQualified);
    if (selfTarget.length === 1) return { id: selfTarget[0].node.id, resolution: 'exact' as const };
    return undefined;
  }

  if (!call.explicitReceiver) {
    // Python bare-name lookup không tự nhảy vào method cùng class; ưu tiên def module-level cùng file.
    const local = moduleTargets(record.moduleNames, name, byModuleQualified)
      .filter((candidate) => candidate.node.file === record.node.file);
    if (local.length === 1) return { id: local[0].node.id, resolution: 'same-file' as const };
    const binding = scope?.imported.get(name);
    if (!binding) return undefined;
    const imported = moduleTargets([binding.module], binding.symbol, byModuleQualified);
    if (imported.length === 1) return { id: imported[0].node.id, resolution: 'import' as const };
    return undefined;
  }

  if (scope) {
    const moduleBinding = [...scope.modules.entries()]
      .filter(([local]) => receiver === local || receiver.startsWith(`${local}.`))
      .sort(([a], [b]) => b.length - a.length)[0];
    if (moduleBinding) {
      const [local, targetModule] = moduleBinding;
      const mapped = `${targetModule}${receiver.slice(local.length)}`;
      const imported = mappedReceiverTargets(mapped, name, byModuleQualified);
      if (imported.length === 1) return { id: imported[0].node.id, resolution: 'import' as const };
      return undefined;
    }

    const first = receiver.split('.')[0];
    const fromBinding = scope.imported.get(first);
    if (fromBinding) {
      const remainder = receiver.slice(first.length).replace(/^\./, '');
      const childModule = [fromBinding.module, fromBinding.symbol, remainder].filter(Boolean).join('.');
      const asModule = mappedReceiverTargets(childModule, name, byModuleQualified);
      const asSymbol = moduleTargets(
        [fromBinding.module],
        [fromBinding.symbol, remainder, name].filter(Boolean).join('.'),
        byModuleQualified
      );
      const imported = uniqueRecords([...asModule, ...asSymbol]);
      if (imported.length === 1) return { id: imported[0].node.id, resolution: 'import' as const };
      return undefined;
    }
  }

  // ClassName.method() chỉ được nối khi class nằm trong đúng module hiện tại.
  const localClass = moduleTargets(record.moduleNames, `${receiver}.${name}`, byModuleQualified)
    .filter((candidate) => candidate.node.file === record.node.file);
  if (localClass.length === 1) return { id: localClass[0].node.id, resolution: 'exact' as const };
  return undefined;
}

function resolveCallTarget(
  record: DefRecord,
  call: CallRecord,
  byQualified: Map<string, DefRecord[]>,
  bySimple: Map<string, DefRecord[]>,
  pythonScopes: Map<string, PythonScope>,
  byModuleQualified: Map<string, DefRecord[]>
) {
  if (record.grammar === 'python') {
    return pythonCallTarget(record, call, pythonScopes.get(record.node.file), byModuleQualified);
  }
  const name = normalizeQualified(call.name);
  const receiver = normalizeQualified(call.receiver);
  const owner = normalizeQualified(record.ownerName);
  const selfReceivers = ['this', 'self', normalizeQualified(record.selfReceiver)].filter(Boolean);
  const receiverTargetsCurrentOwner = !call.explicitReceiver || selfReceivers.includes(receiver);

  const qualifiedCandidates = [
    receiver && !selfReceivers.includes(receiver) ? `${receiver}.${name}` : '',
    receiverTargetsCurrentOwner && owner ? `${owner}.${name}` : ''
  ]
    .filter(Boolean)
    .flatMap((key) => byQualified.get(key) ?? []);
  const exact = [...new Map(qualifiedCandidates.map((item) => [item.node.id, item])).values()];
  const exactSameFile = exact.filter((item) => item.node.file === record.node.file);
  if (exactSameFile.length === 1) return { id: exactSameFile[0].node.id, resolution: 'exact' as const };
  if (exact.length === 1) return { id: exact[0].node.id, resolution: 'exact' as const };

  const sameFile = (bySimple.get(name) ?? []).filter((item) => item.node.file === record.node.file);
  if (!call.explicitReceiver && sameFile.length === 1) return { id: sameFile[0].node.id, resolution: 'same-file' as const };

  // Receiver không map được vào owner exact thì cố ý unresolved, không đoán theo tên.
  return undefined;
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
  const byQualified = new Map<string, DefRecord[]>();
  const bySimple = new Map<string, DefRecord[]>();
  const byModuleQualified = new Map<string, DefRecord[]>();
  const pythonScopes = new Map<string, PythonScope>();
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

    const pythonModules = config.grammar === 'python' ? pythonModuleInfos(configFiles) : new Map<string, PythonModuleInfo>();
    for (const file of configFiles) {
      const tree = parser.parse(file.content);
      const startToId = new Map<number, DefRecord>();
      const pythonModule = pythonModules.get(file.path);
      if (pythonModule) pythonScopes.set(file.path, pythonScope(tree.rootNode, pythonModule));

      for (const match of defQuery.matches(tree.rootNode)) {
        const defNode = match.captures.find((c) => c.name === 'def')?.node;
        const nameNode = match.captures.find((c) => c.name === 'name')?.node;
        if (!defNode || !nameNode) continue;
        const bare = nameNode.text.split(/::|\./).at(-1) ?? nameNode.text;
        const owner = enclosingOwner(defNode, config);
        const prefix = owner.name;
        const display = prefix ? `${prefix}.${bare}` : bare;
        let parent = defNode.parent;
        let nestedInFunction = false;
        while (parent) {
          if (config.defTypes.includes(parent.type)) {
            nestedInFunction = true;
            break;
          }
          parent = parent.parent;
        }
        const line = nameNode.startPosition.row + 1;
        const id = uniqueId(`${file.path}#${display}`, usedIds, line);
        const record: DefRecord = {
          grammar: config.grammar,
          ownerName: prefix,
          selfReceiver: owner.selfReceiver,
          moduleNames: pythonModule?.aliases ?? [],
          moduleQualifiedName: nestedInFunction ? '' : normalizeQualified(display),
          calls: [],
          node: {
            id,
            name: display,
            file: file.path,
            line,
            code: defNode.text,
            body: defNode.text,
            complexity: complexityOf(defNode, config.defTypes, config.branchTypes),
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
        const simpleList = bySimple.get(bare) ?? [];
        simpleList.push(record);
        bySimple.set(bare, simpleList);
        const qualified = normalizeQualified(prefix ? `${prefix}.${bare}` : bare);
        const qualifiedList = byQualified.get(qualified) ?? [];
        qualifiedList.push(record);
        byQualified.set(qualified, qualifiedList);
        if (record.moduleQualifiedName) {
          for (const moduleName of record.moduleNames) {
            const key = moduleKey(moduleName, record.moduleQualifiedName);
            const moduleList = byModuleQualified.get(key) ?? [];
            moduleList.push(record);
            byModuleQualified.set(key, moduleList);
          }
        }
      }

      // Ghi receiver + owner của call site; resolve đích sau khi đã có toàn bộ symbol table.
      for (const match of callQuery.matches(tree.rootNode)) {
        const callNode = match.captures.find((c) => c.name === 'call')?.node;
        const nameNode = match.captures.find((c) => c.name === 'c')?.node;
        if (!callNode || !nameNode) continue;
        const start = nearestDefStart(callNode, config.defTypes);
        if (start === null) continue;
        const record = startToId.get(start);
        if (record) record.calls.push(callParts(callNode, nameNode));
      }

      tree.delete();
    }
  }

  const edges = new Map<string, GraphEdge>();
  for (const record of records) {
    for (const call of record.calls) {
      const target = resolveCallTarget(record, call, byQualified, bySimple, pythonScopes, byModuleQualified);
      if (!target) continue;
      const key = `${record.node.id}>${target.id}`;
      const existing = edges.get(key);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        continue;
      }
      edges.set(key, {
        from: record.node.id,
        to: target.id,
        cycle: false,
        kind: record.node.id === target.id ? 'recursive' : 'call',
        count: 1,
        resolution: target.resolution
      });
    }
  }

  return { nodes: records.map((r) => r.node), edges: [...edges.values()] };
}
