import {
  ModuleKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type CallExpression,
  type FunctionDeclaration,
  type MethodDeclaration,
  type Node as MorphNode,
  type SourceFile,
  type VariableDeclaration,
  ts
} from 'ts-morph';
import type { Graph, GraphEdge, GraphNode, SourceFileInput } from './types';

const SUPPORTED_EXT = /\.(cjs|mjs|js|jsx|ts|tsx)$/i;

interface FunctionRecord {
  id: string;
  node: GraphNode;
  ast: FunctionDeclaration | MethodDeclaration | VariableDeclaration;
  bodyAst?: MorphNode;
}

function normalizePath(path: string) {
  const value = path.replace(/\\/g, '/').replace(/^\.\//, '');
  const cwd = typeof process !== 'undefined' ? process.cwd().replace(/\\/g, '/') : '';
  if (cwd && value.startsWith(`${cwd}/`)) return value.slice(cwd.length + 1);
  return value.replace(/^[A-Za-z]:\//, '').replace(/^\//, '');
}

function lineOf(source: SourceFile, node: MorphNode) {
  return source.getLineAndColumnAtPos(node.getStart()).line;
}

function bodyText(body?: MorphNode) {
  if (!body) return '';
  if (Node.isBlock(body)) {
    return body.getStatements().map((statement) => statement.getText()).join('\n');
  }
  return body.getText();
}

function displayMethodName(method: MethodDeclaration) {
  const parent = method.getParent();
  const methodName = method.getName();
  if (Node.isClassDeclaration(parent) && parent.getName()) {
    return `${parent.getName()}.${methodName}`;
  }
  return methodName;
}

function uniqueId(base: string, used: Set<string>, line: number) {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const withLine = `${base}@${line}`;
  if (!used.has(withLine)) {
    used.add(withLine);
    return withLine;
  }
  let index = 2;
  while (used.has(`${withLine}-${index}`)) index += 1;
  const id = `${withLine}-${index}`;
  used.add(id);
  return id;
}

function declarationKey(node: MorphNode) {
  return `${normalizePath(node.getSourceFile().getFilePath())}:${node.getStart()}`;
}

function normalizeDeclaration(declaration: MorphNode): MorphNode | undefined {
  if (Node.isFunctionDeclaration(declaration) || Node.isMethodDeclaration(declaration) || Node.isVariableDeclaration(declaration)) {
    return declaration;
  }
  const variable = declaration.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
  if (variable) return variable;
  const fn = declaration.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration);
  if (fn) return fn;
  const method = declaration.getFirstAncestorByKind(SyntaxKind.MethodDeclaration);
  if (method) return method;
  return undefined;
}

function isFunctionInitializer(node: MorphNode | undefined) {
  return !!node && (Node.isArrowFunction(node) || Node.isFunctionExpression(node));
}

// Ranh giới một "hàm con" — dùng để không đếm lời gọi bên trong nó cho hàm ngoài.
function isNestedFunction(node: MorphNode) {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isConstructorDeclaration(node) ||
    Node.isGetAccessorDeclaration(node) ||
    Node.isSetAccessorDeclaration(node)
  );
}

function createProject(files: SourceFileInput[]) {
  const project = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });

  for (const file of files) {
    if (!SUPPORTED_EXT.test(file.path)) continue;
    project.createSourceFile(normalizePath(file.path), file.content, { overwrite: true });
  }

  project.resolveSourceFileDependencies();
  return project;
}

function collectFunctions(project: Project) {
  const records: FunctionRecord[] = [];
  const declarationToId = new Map<string, string>();
  const names = new Map<string, string[]>();
  const usedIds = new Set<string>();

  function remember(record: FunctionRecord, aliases: MorphNode[]) {
    records.push(record);
    for (const alias of aliases) {
      declarationToId.set(declarationKey(alias), record.id);
    }
    const list = names.get(record.node.name) ?? [];
    list.push(record.id);
    names.set(record.node.name, list);
  }

  function build(
    name: string,
    ast: FunctionDeclaration | MethodDeclaration | VariableDeclaration,
    body: MorphNode | undefined,
    aliases: MorphNode[],
    file: string,
    source: SourceFile
  ) {
    const line = lineOf(source, ast);
    const id = uniqueId(`${file}#${name}`, usedIds, line);
    remember({
      id,
      ast,
      bodyAst: body,
      node: {
        id,
        name,
        file,
        line,
        code: ast.getText(),
        body: bodyText(body),
        complexity: 1,
        fanIn: 0,
        fanOut: 0,
        inCycle: false,
        issues: [],
        level: 'ok',
        score: 0
      }
    }, aliases);
  }

  for (const source of project.getSourceFiles()) {
    const file = normalizePath(source.getFilePath());

    // Một lượt duyệt: bắt hàm khai báo (mọi độ sâu, kể cả hàm con),
    // arrow/function expression gán vào biến, và method trong class.
    source.forEachDescendant((node) => {
      if (Node.isFunctionDeclaration(node) && node.getName() && node.getBody()) {
        build(node.getName()!, node, node.getBody(), [node], file, source);
        return;
      }
      if (Node.isVariableDeclaration(node) && isFunctionInitializer(node.getInitializer())) {
        const initializer = node.getInitializerOrThrow();
        const body = Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)
          ? initializer.getBody()
          : undefined;
        build(node.getName(), node, body, [node, initializer], file, source);
        return;
      }
      if (Node.isMethodDeclaration(node) && node.getBody()) {
        build(displayMethodName(node), node, node.getBodyOrThrow(), [node], file, source);
      }
    });
  }

  return { records, declarationToId, names };
}

function callName(call: CallExpression) {
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return undefined;
}

function edgeKind(call: CallExpression, from: string, to: string) {
  if (from === to) return 'recursive';
  const awaited = call.getAncestors().some((ancestor) => ancestor.getKind() === SyntaxKind.AwaitExpression);
  return awaited ? 'async' : 'call';
}

function resolveCallTarget(
  call: CallExpression,
  currentFile: string,
  declarationToId: Map<string, string>,
  names: Map<string, string[]>
) {
  const expr = call.getExpression();
  const symbols = [expr.getSymbol(), expr.getSymbol()?.getAliasedSymbol()].filter(Boolean);

  for (const symbol of symbols) {
    for (const declaration of symbol?.getDeclarations() ?? []) {
      const normalized = normalizeDeclaration(declaration);
      if (!normalized) continue;
      const id = declarationToId.get(declarationKey(normalized));
      if (id) return id;
    }
  }

  const name = callName(call);
  if (!name) return undefined;
  const candidates = names.get(name) ?? [];
  if (candidates.length === 1) return candidates[0];
  return candidates.find((id) => id.startsWith(`${currentFile}#`));
}

function complexityOf(body?: MorphNode) {
  if (!body) return 1;
  let complexity = 1;
  body.forEachDescendant((node, traversal) => {
    // Không tính nhánh rẽ nằm trong hàm con — mỗi hàm con là một đơn vị riêng.
    if (isNestedFunction(node)) {
      traversal.skip();
      return;
    }
    switch (node.getKind()) {
      case SyntaxKind.IfStatement:
      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement:
      case SyntaxKind.CaseClause:
      case SyntaxKind.CatchClause:
      case SyntaxKind.ConditionalExpression:
        complexity += 1;
        break;
      case SyntaxKind.BinaryExpression: {
        const binary = node.asKindOrThrow(SyntaxKind.BinaryExpression);
        const operator = binary.getOperatorToken().getKind();
        if (operator === SyntaxKind.AmpersandAmpersandToken || operator === SyntaxKind.BarBarToken) {
          complexity += 1;
        }
        break;
      }
      default:
        break;
    }
  });
  return complexity;
}

export function parseSources(files: SourceFileInput[]): Graph {
  const project = createProject(files);
  const { records, declarationToId, names } = collectFunctions(project);
  const edgeMap = new Map<string, GraphEdge>();

  for (const record of records) {
    record.node.complexity = complexityOf(record.bodyAst);
    const currentFile = record.node.file;
    const handleCall = (node: CallExpression) => {
      const target = resolveCallTarget(node, currentFile, declarationToId, names);
      if (!target) return;
      const key = `${record.id}>${target}`;
      const existing = edgeMap.get(key);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        return;
      }
      edgeMap.set(key, {
        from: record.id,
        to: target,
        cycle: false,
        kind: edgeKind(node, record.id, target),
        count: 1
      });
    };
    const root = record.bodyAst;
    if (root) {
      if (Node.isCallExpression(root)) handleCall(root);
      root.forEachDescendant((node, traversal) => {
        // Đây là một hàm con đã được coi là node riêng → không đếm lời gọi của nó cho hàm ngoài.
        if (isNestedFunction(node) && declarationToId.has(declarationKey(node))) {
          traversal.skip();
          return;
        }
        if (Node.isCallExpression(node)) handleCall(node);
      });
    }
  }

  return {
    nodes: records.map((record) => record.node),
    edges: [...edgeMap.values()]
  };
}

export function analyzeGraph(graph: Graph): Graph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const out = new Map<string, string[]>();

  for (const node of graph.nodes) {
    node.fanIn = 0;
    node.fanOut = 0;
    node.inCycle = false;
    node.issues = [];
    out.set(node.id, []);
  }

  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    out.get(edge.from)?.push(edge.to);
    from.fanOut += 1;
    to.fanIn += 1;
    edge.cycle = false;
  }

  let index = 0;
  let sccCount = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const low = new Map<string, number>();
  const num = new Map<string, number>();
  const sccOf = new Map<string, number>();

  function strongConnect(id: string) {
    num.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of out.get(id) ?? []) {
      if (!num.has(next)) {
        strongConnect(next);
        low.set(id, Math.min(low.get(id) ?? 0, low.get(next) ?? 0));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id) ?? 0, num.get(next) ?? 0));
      }
    }

    if (low.get(id) === num.get(id)) {
      const component: string[] = [];
      let current = '';
      do {
        current = stack.pop() ?? '';
        onStack.delete(current);
        sccOf.set(current, sccCount);
        component.push(current);
      } while (current && current !== id);

      if (component.length > 1) {
        for (const member of component) {
          const node = byId.get(member);
          if (node) node.inCycle = true;
        }
      }
      sccCount += 1;
    }
  }

  for (const node of graph.nodes) {
    if (!num.has(node.id)) strongConnect(node.id);
  }

  for (const edge of graph.edges) {
    if (edge.from === edge.to) {
      byId.get(edge.from)!.inCycle = true;
      edge.cycle = true;
      continue;
    }
    if (sccOf.get(edge.from) === sccOf.get(edge.to) && byId.get(edge.from)?.inCycle) {
      edge.cycle = true;
    }
  }

  for (const node of graph.nodes) {
    // Điểm rối ở dạng mã hoá (code + value); client dịch ra ngôn ngữ đang chọn qua i18n.
    if (node.inCycle) {
      node.issues.push({ code: 'cycle', fix: 'tangle' });
    }
    if (node.complexity >= 10) {
      node.issues.push({ code: 'complexity', value: node.complexity, fix: 'warn' });
    }
    if (node.fanOut >= 5) {
      node.issues.push({ code: 'fanOut', value: node.fanOut, fix: 'warn' });
    }
    if (node.fanIn >= 5) {
      node.issues.push({ code: 'fanIn', value: node.fanIn, fix: 'accent' });
    }
    node.level = node.inCycle || node.complexity >= 12 ? 'hot' : node.issues.length ? 'warn' : 'ok';
    node.score = (node.inCycle ? 100 : 0) + node.complexity * 3 + node.fanIn + node.fanOut;
  }

  return graph;
}

export function analyzeSources(files: SourceFileInput[]): Graph {
  return analyzeGraph(parseSources(files));
}
