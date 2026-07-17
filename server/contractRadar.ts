// Contract Radar — dựng các cạnh HTTP "vô hình" giữa client call và backend route.
// MVP chỉ JS/TS, static + local: fetch/axios ↔ Express/Fastify/Next App Router.
import {
  ModuleKind,
  Node,
  Project,
  ScriptTarget,
  SyntaxKind,
  type CallExpression,
  type Expression,
  type Node as MorphNode,
  type SourceFile,
  ts
} from 'ts-morph';
import type {
  ContractConfidence,
  ContractRadarReport,
  ContractUnknown,
  HttpContractEndpoint,
  HttpContractFramework,
  HttpContractIssue,
  HttpContractDetails,
  HttpContractObservation,
  HttpMethod,
  SourceFileInput
} from '../src/types';
import { JS_TS, TEST_NAME, TYPE_DECL, normalizePath } from './moduleGraph';

const CLIENT_METHODS = new Set<HttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']);
const ROUTE_METHODS = new Map<string, HttpMethod>([
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['options', 'OPTIONS'],
  ['head', 'HEAD'],
  ['all', 'ANY']
]);

interface ExtractedPath {
  path: string;
  confidence: ContractConfidence;
}

interface Receiver {
  key: string;
  framework: 'express' | 'fastify';
  router: boolean;
}

interface RouteDraft {
  receiverKey: string;
  method: HttpMethod;
  path: string;
  confidence: ContractConfidence;
  file: string;
  line: number;
  position: number;
  framework: 'express' | 'fastify';
  contract: HttpContractDetails;
}

interface Mount {
  parentKey: string;
  childKey: string;
  prefix: string;
}

function canonicalFiles(files: SourceFileInput[]) {
  const byPath = new Map<string, string>();
  for (const file of files) {
    const path = normalizePath(file.path);
    if (!path || !JS_TS.test(path) || TYPE_DECL.test(path)) continue;
    if (!byPath.has(path)) byPath.set(path, file.content);
  }
  return [...byPath.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, content]) => ({ path, content }));
}

function createProject(files: SourceFileInput[]) {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      module: ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      experimentalDecorators: true,
      target: ScriptTarget.ES2022
    }
  });
  for (const file of files) project.createSourceFile(file.path, file.content, { overwrite: true });
  project.resolveSourceFileDependencies();
  return project;
}

function normalizeHttpPath(raw: string) {
  let value = raw.trim();
  if (!value) return '/';
  if (/^https?:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return undefined;
    }
  } else {
    value = value.split(/[?#]/, 1)[0];
  }
  value = value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!value.startsWith('/')) value = `/${value}`;
  if (value.length > 1) value = value.replace(/\/+$/, '');
  return value || '/';
}

function extractedPath(node: MorphNode | undefined): ExtractedPath | undefined {
  if (!node) return undefined;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    const path = normalizeHttpPath(node.getLiteralText());
    return path ? { path, confidence: 'exact' } : undefined;
  }
  if (Node.isTemplateExpression(node)) {
    let value = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) value += `:dynamic${span.getLiteral().getLiteralText()}`;
    const path = normalizeHttpPath(value);
    return path ? { path, confidence: 'pattern' } : undefined;
  }
  return undefined;
}

function literalText(node: MorphNode | undefined) {
  if (node && (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node))) {
    return node.getLiteralText();
  }
  return undefined;
}

function objectStringProperty(node: MorphNode | undefined, name: string) {
  if (!node || !Node.isObjectLiteralExpression(node)) return undefined;
  const property = node.getProperty(name);
  if (!property || !Node.isPropertyAssignment(property)) return undefined;
  return literalText(property.getInitializer());
}

function objectProperty(node: MorphNode | undefined, name: string) {
  if (!node || !Node.isObjectLiteralExpression(node)) return undefined;
  const property = node.getProperty(name);
  return property && Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
}

function objectKeys(node: MorphNode | undefined) {
  if (!node || !Node.isObjectLiteralExpression(node)) return [];
  return node
    .getProperties()
    .flatMap((property) => {
      if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property) || Node.isMethodDeclaration(property)) {
        return [property.getName()];
      }
      return [];
    })
    .sort();
}

function jsonBodyFields(node: MorphNode | undefined) {
  if (!node) return [];
  if (Node.isObjectLiteralExpression(node)) return objectKeys(node);
  if (!Node.isCallExpression(node)) return [];
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'stringify') return [];
  return objectKeys(node.getArguments()[0]);
}

function hasAuthorizationHeader(node: MorphNode | undefined): 'present' | 'absent' | 'unknown' {
  if (!node) return 'absent';
  if (!Node.isObjectLiteralExpression(node)) return 'unknown';
  const headers = objectProperty(node, 'headers');
  if (!headers) return 'absent';
  if (!Node.isObjectLiteralExpression(headers)) return 'unknown';
  const keys = headers.getProperties().flatMap((property) => {
    if (Node.isPropertyAssignment(property) || Node.isShorthandPropertyAssignment(property)) return [property.getName().toLowerCase()];
    return [];
  });
  return keys.includes('authorization') ? 'present' : 'absent';
}

function emptyContract(auth: HttpContractDetails['auth'] = 'unknown'): HttpContractDetails {
  return { requestFields: [], responseFields: [], auth, statuses: [] };
}

function sourcePath(source: SourceFile) {
  return normalizePath(source.getFilePath());
}

function location(node: MorphNode) {
  return node.getSourceFile().getLineAndColumnAtPos(node.getStart());
}

function shortExpression(node: MorphNode) {
  const text = node.getText().replace(/\s+/g, ' ');
  return text.length <= 240 ? text : `${text.slice(0, 237)}…`;
}

function endpoint(
  side: 'client' | 'server',
  method: HttpMethod,
  path: string,
  file: string,
  line: number,
  position: number,
  framework: HttpContractFramework,
  confidence: ContractConfidence,
  contract: HttpContractDetails = emptyContract()
): HttpContractEndpoint {
  return {
    id: `${side}:${method}:${path}:${file}:${line}:${position}`,
    side,
    method,
    path,
    file,
    line,
    framework,
    confidence,
    contract,
    coveredBy: []
  };
}

function unknown(side: 'client' | 'server', node: MorphNode, reason: string): ContractUnknown {
  const { line } = location(node);
  return {
    side,
    file: sourcePath(node.getSourceFile()),
    line,
    expression: shortExpression(node),
    reason
  };
}

function axiosClients(source: SourceFile) {
  const clients = new Map<string, string>();
  for (const declaration of source.getImportDeclarations()) {
    if (declaration.getModuleSpecifierValue() !== 'axios') continue;
    const defaultImport = declaration.getDefaultImport();
    const namespaceImport = declaration.getNamespaceImport();
    if (defaultImport) clients.set(defaultImport.getText(), '');
    if (namespaceImport) clients.set(namespaceImport.getText(), '');
  }
  const shadowsGlobal = source.getVariableDeclarations().some((declaration) => declaration.getName() === 'axios');
  if (!shadowsGlobal && !clients.has('axios')) clients.set('axios', '');
  for (const declaration of source.getVariableDeclarations()) {
    const initializer = declaration.getInitializer();
    if (!initializer || !Node.isCallExpression(initializer)) continue;
    const expression = initializer.getExpression();
    if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== 'create') continue;
    const root = expression.getExpression().getText();
    if (!clients.has(root)) continue;
    const baseUrl = objectStringProperty(initializer.getArguments()[0], 'baseURL') ?? '';
    clients.set(declaration.getName(), baseUrl);
  }
  return clients;
}

function assignedVariable(call: CallExpression) {
  for (const ancestor of call.getAncestors()) {
    if (Node.isVariableDeclaration(ancestor)) return ancestor.getName();
    if (
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor)
    ) {
      return undefined;
    }
  }
  return undefined;
}

function analysisScope(node: MorphNode) {
  return (
    node.getFirstAncestor((ancestor) =>
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor)
    ) ?? node.getSourceFile()
  );
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function clientResponseContract(call: CallExpression, framework: 'fetch' | 'axios') {
  const response = assignedVariable(call);
  if (!response || !/^[$A-Z_a-z][$\w]*$/.test(response)) return { responseFields: [], statuses: [] };
  const scope = analysisScope(call);
  const text = scope.getText();
  const statuses = [...text.matchAll(new RegExp(`\\b${escaped(response)}\\s*\\.\\s*status\\s*(?:===|==)\\s*(\\d{3})`, 'g'))]
    .map((match) => Number(match[1]));
  const fields = new Set<string>();
  if (framework === 'axios') {
    for (const match of text.matchAll(new RegExp(`\\b${escaped(response)}\\s*\\.\\s*data\\s*\\.\\s*([$A-Z_a-z][$\\w]*)`, 'g'))) {
      fields.add(match[1]);
    }
  } else {
    for (const declaration of scope.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
      const initializer = declaration.getInitializer();
      if (!initializer) continue;
      const initText = initializer.getText().replace(/\s+/g, '');
      if (!new RegExp(`(?:await)?${escaped(response)}\\.json\\(\\)`).test(initText)) continue;
      const dataName = declaration.getName();
      if (!/^[$A-Z_a-z][$\w]*$/.test(dataName)) continue;
      for (const match of text.matchAll(new RegExp(`\\b${escaped(dataName)}\\s*\\.\\s*([$A-Z_a-z][$\\w]*)`, 'g'))) {
        fields.add(match[1]);
      }
    }
  }
  return { responseFields: [...fields].sort(), statuses: [...new Set(statuses)].sort((a, b) => a - b) };
}

function clientContract(call: CallExpression, framework: 'fetch' | 'axios', method: HttpMethod) {
  const args = call.getArguments();
  let requestFields: string[] = [];
  let auth: HttpContractDetails['auth'] = 'absent';
  if (framework === 'fetch') {
    const options = args[1];
    requestFields = jsonBodyFields(objectProperty(options, 'body'));
    auth = hasAuthorizationHeader(options);
  } else {
    const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    requestFields = hasBody ? objectKeys(args[1]) : [];
    auth = hasAuthorizationHeader(args[hasBody ? 2 : 1]);
  }
  const response = clientResponseContract(call, framework);
  return { requestFields, auth, ...response };
}

function extractClients(source: SourceFile, clients: HttpContractEndpoint[], unknowns: ContractUnknown[]) {
  const axios = axiosClients(source);
  source.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    const args = node.getArguments();

    if (Node.isIdentifier(expression) && expression.getText() === 'fetch') {
      const path = extractedPath(args[0]);
      let method: HttpMethod | undefined = 'GET';
      if (args[1]) {
        const rawMethod = objectStringProperty(args[1], 'method');
        if (rawMethod) {
          const upper = rawMethod.toUpperCase() as HttpMethod;
          method = CLIENT_METHODS.has(upper) ? upper : undefined;
        } else if (Node.isObjectLiteralExpression(args[1]) && !args[1].getProperty('method')) {
          method = 'GET';
        } else {
          method = undefined;
        }
      }
      if (!path || !method) {
        unknowns.push(unknown('client', node, !path ? 'URL fetch là biểu thức động.' : 'HTTP method của fetch không suy ra được.'));
        return;
      }
      const { line } = location(node);
      clients.push(
        endpoint('client', method, path.path, sourcePath(source), line, node.getStart(), 'fetch', path.confidence, clientContract(node, 'fetch', method))
      );
      return;
    }

    if (!Node.isPropertyAccessExpression(expression)) return;
    const receiver = expression.getExpression();
    const methodName = expression.getName().toLowerCase();
    const method = ROUTE_METHODS.get(methodName);
    if (!Node.isIdentifier(receiver) || !axios.has(receiver.getText()) || !method || method === 'ANY') return;
    const rawPath = extractedPath(args[0]);
    const path = rawPath
      ? { ...rawPath, path: joinHttpPath(axios.get(receiver.getText()) || '/', rawPath.path) }
      : undefined;
    if (!path) {
      unknowns.push(unknown('client', node, 'URL Axios là biểu thức động.'));
      return;
    }
    const { line } = location(node);
    clients.push(
      endpoint('client', method, path.path, sourcePath(source), line, node.getStart(), 'axios', path.confidence, clientContract(node, 'axios', method))
    );
  });
}

function receiverKey(file: string, name: string) {
  return `${file}#${name}`;
}

function initializerReceiver(initializer: Expression | undefined) {
  if (!initializer || !Node.isCallExpression(initializer)) return undefined;
  const callee = initializer.getExpression().getText().replace(/\s+/g, '');
  if (callee === 'express' || callee.endsWith('.express')) return { framework: 'express' as const, router: false };
  if (callee === 'Router' || callee.endsWith('.Router')) return { framework: 'express' as const, router: true };
  if (callee === 'fastify' || callee.endsWith('.fastify')) return { framework: 'fastify' as const, router: false };
  return undefined;
}

function collectReceivers(project: Project) {
  const receivers = new Map<string, Receiver>();
  for (const source of project.getSourceFiles()) {
    const file = sourcePath(source);
    for (const declaration of source.getVariableDeclarations()) {
      const found = initializerReceiver(declaration.getInitializer());
      if (!found) continue;
      const key = receiverKey(file, declaration.getName());
      receivers.set(key, { key, ...found });
    }
    for (const parameter of source.getDescendantsOfKind(SyntaxKind.Parameter)) {
      const name = parameter.getName();
      const type = parameter.getTypeNode()?.getText() ?? '';
      const conventionalFastify = /^fastify$/i.test(name);
      if (!/^(app|router|server|fastify)$/i.test(name) || (!conventionalFastify && !/(Express|Router|FastifyInstance)/.test(type))) continue;
      const framework = conventionalFastify || /Fastify/.test(type) ? 'fastify' : 'express';
      const key = receiverKey(file, name);
      receivers.set(key, { key, framework, router: /Router/.test(type) || /^router$/i.test(name) });
    }
  }
  return receivers;
}

function resolveReceiver(node: MorphNode, receivers: Map<string, Receiver>, visited = new Set<MorphNode>()): string | undefined {
  if (visited.has(node)) return undefined;
  visited.add(node);
  if (Node.isIdentifier(node)) {
    const local = receiverKey(sourcePath(node.getSourceFile()), node.getText());
    if (receivers.has(local)) return local;
  }

  const symbol = node.getSymbol();
  const aliased = symbol?.getAliasedSymbol();
  for (const candidate of [symbol, aliased]) {
    for (const declaration of candidate?.getDeclarations() ?? []) {
      if (Node.isVariableDeclaration(declaration) || Node.isParameterDeclaration(declaration)) {
        const key = receiverKey(sourcePath(declaration.getSourceFile()), declaration.getName());
        if (receivers.has(key)) return key;
      }
      if (Node.isExportAssignment(declaration)) {
        const resolved = resolveReceiver(declaration.getExpression(), receivers, visited);
        if (resolved) return resolved;
      }
    }
  }
  return undefined;
}

function resolvePluginReceiver(node: MorphNode, receivers: Map<string, Receiver>) {
  const declarations = [node.getSymbol(), node.getSymbol()?.getAliasedSymbol()].flatMap((symbol) => symbol?.getDeclarations() ?? []);
  for (const declaration of declarations) {
    let functionNode: MorphNode | undefined = declaration;
    if (Node.isVariableDeclaration(declaration)) functionNode = declaration.getInitializer();
    if (Node.isExportAssignment(declaration)) functionNode = declaration.getExpression();
    if (
      functionNode &&
      (Node.isFunctionDeclaration(functionNode) || Node.isFunctionExpression(functionNode) || Node.isArrowFunction(functionNode))
    ) {
      const first = functionNode.getParameters()[0];
      if (!first) continue;
      const key = receiverKey(sourcePath(first.getSourceFile()), first.getName());
      if (receivers.has(key)) return key;
    }
  }
  return resolveReceiver(node, receivers);
}

function directRoute(call: CallExpression, receivers: Map<string, Receiver>) {
  const expression = call.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return undefined;
  const method = ROUTE_METHODS.get(expression.getName().toLowerCase());
  if (!method) return undefined;
  const base = expression.getExpression();

  if (Node.isCallExpression(base)) {
    const routeExpression = base.getExpression();
    if (!Node.isPropertyAccessExpression(routeExpression) || routeExpression.getName() !== 'route') return undefined;
    const key = resolveReceiver(routeExpression.getExpression(), receivers);
    return key ? { key, method, pathNode: base.getArguments()[0] } : undefined;
  }

  const key = resolveReceiver(base, receivers);
  return key ? { key, method, pathNode: call.getArguments()[0] } : undefined;
}

function numberLiteral(node: MorphNode | undefined) {
  if (!node || !Node.isNumericLiteral(node)) return undefined;
  return Number(node.getLiteralValue());
}

function handlerContract(handler: MorphNode | undefined, authRequired = false, forcedStatuses: number[] = []): HttpContractDetails {
  const contract = emptyContract(authRequired ? 'required' : 'absent');
  contract.statuses.push(...forcedStatuses);
  if (
    !handler ||
    !(
      Node.isArrowFunction(handler) ||
      Node.isFunctionExpression(handler) ||
      Node.isFunctionDeclaration(handler) ||
      Node.isMethodDeclaration(handler)
    )
  ) {
    return contract;
  }
  const parameters = handler.getParameters();
  const requestName = parameters[0]?.getName() ?? 'req';
  const responseName = parameters[1]?.getName() ?? 'res';
  const requestFields = new Set<string>();
  const responseFields = new Set<string>();
  let sendsResponse = false;

  handler.forEachDescendant((node) => {
    if (Node.isPropertyAccessExpression(node)) {
      const base = node.getExpression().getText().replace(/\s+/g, '');
      if (base === `${requestName}.body`) requestFields.add(node.getName());
      return;
    }
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) return;
    const name = expression.getName();
    const receiver = expression.getExpression().getText().replace(/\s+/g, '');
    const belongsToResponse = receiver === responseName || receiver.startsWith(`${responseName}.`) || receiver.startsWith(`${responseName}(`);
    if (!belongsToResponse) return;
    if (name === 'status' || name === 'code' || name === 'sendStatus') {
      const status = numberLiteral(node.getArguments()[0]);
      if (status) contract.statuses.push(status);
      if (name === 'sendStatus') sendsResponse = true;
    }
    if (name === 'json' || name === 'send') {
      sendsResponse = true;
      for (const field of objectKeys(node.getArguments()[0])) responseFields.add(field);
    }
  });

  if (sendsResponse && contract.statuses.length === 0) contract.statuses.push(200);
  contract.requestFields = [...requestFields].sort();
  contract.responseFields = [...responseFields].sort();
  contract.statuses = [...new Set(contract.statuses)].sort((a, b) => a - b);
  return contract;
}

function authMiddleware(nodes: MorphNode[]) {
  return nodes.some((node) => /(?:^|\W)(?:\w*auth\w*|guard|require\w*user|verify\w*token)(?:\W|$)/i.test(node.getText()));
}

function routeContract(call: CallExpression, pathNode: MorphNode | undefined) {
  const args = call.getArguments();
  const handler = args.at(-1);
  const middleware = args.filter((arg) => arg !== pathNode && arg !== handler);
  return handlerContract(handler, authMiddleware(middleware));
}

function extractServerRoutes(
  project: Project,
  receivers: Map<string, Receiver>,
  drafts: RouteDraft[],
  mounts: Mount[],
  unknowns: ContractUnknown[],
  skippedFiles: Set<string>
) {
  for (const source of project.getSourceFiles()) {
    if (skippedFiles.has(sourcePath(source))) continue;
    source.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return;
      const expression = node.getExpression();

      if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'use') {
        const parentKey = resolveReceiver(expression.getExpression(), receivers);
        const args = node.getArguments();
        const prefix = extractedPath(args[0]);
        const receiverArgs = prefix ? args.slice(1) : args;
        const childKey = receiverArgs.map((arg) => resolveReceiver(arg, receivers)).find(Boolean);
        if (parentKey && childKey) mounts.push({ parentKey, childKey, prefix: prefix?.path ?? '/' });
        else if (parentKey && prefix && receiverArgs.length > 0) {
          unknowns.push(unknown('server', node, 'Router mount có prefix tĩnh nhưng receiver con không resolve được.'));
        }
        return;
      }

      if (Node.isPropertyAccessExpression(expression) && expression.getName() === 'register') {
        const parentKey = resolveReceiver(expression.getExpression(), receivers);
        const args = node.getArguments();
        const childKey = args[0] ? resolvePluginReceiver(args[0], receivers) : undefined;
        const prefix = objectStringProperty(args[1], 'prefix') ?? '/';
        if (parentKey && childKey) mounts.push({ parentKey, childKey, prefix: normalizeHttpPath(prefix) ?? '/' });
        else if (parentKey && args[0]) unknowns.push(unknown('server', node, 'Fastify plugin receiver không resolve được.'));
        return;
      }

      const route = directRoute(node, receivers);
      if (!route) return;
      // app.get('setting') của Express không phải route; route cần ít nhất path + handler.
      const isChainedRoute = Node.isPropertyAccessExpression(expression) && Node.isCallExpression(expression.getExpression());
      if (!isChainedRoute && node.getArguments().length < 2) return;
      const path = extractedPath(route.pathNode);
      if (!path) {
        unknowns.push(unknown('server', node, 'Path route là biểu thức động.'));
        return;
      }
      const receiver = receivers.get(route.key)!;
      const { line } = location(node);
      drafts.push({
        receiverKey: route.key,
        method: route.method,
        path: path.path,
        confidence: path.confidence,
        file: sourcePath(source),
        line,
        position: node.getStart(),
        framework: receiver.framework,
        contract: routeContract(node, route.pathNode)
      });
    });
  }
}

function joinHttpPath(prefix: string, route: string) {
  if (prefix === '/') return route;
  if (route === '/') return prefix;
  return normalizeHttpPath(`${prefix}/${route}`) ?? route;
}

function prefixesFor(key: string, mounts: Mount[], seen = new Set<string>()): string[] {
  if (seen.has(key)) return [''];
  const incoming = mounts.filter((mount) => mount.childKey === key);
  if (incoming.length === 0) return [''];
  const nextSeen = new Set(seen).add(key);
  return [
    ...new Set(
      incoming.flatMap((mount) =>
        prefixesFor(mount.parentKey, mounts, nextSeen).map((parentPrefix) => joinHttpPath(parentPrefix || '/', mount.prefix))
      )
    )
  ].sort((a, b) => a.localeCompare(b));
}

function materializeRoutes(drafts: RouteDraft[], mounts: Mount[]) {
  const routes = drafts.flatMap((draft) =>
    prefixesFor(draft.receiverKey, mounts).map((prefix) => {
      const path = prefix ? joinHttpPath(prefix, draft.path) : draft.path;
      return endpoint(
        'server',
        draft.method,
        path,
        draft.file,
        draft.line,
        draft.position,
        draft.framework,
        draft.confidence,
        draft.contract
      );
    })
  );
  return [...new Map(routes.map((route) => [route.id, route])).values()];
}

function nextRoutePath(file: string) {
  const parts = normalizePath(file).split('/');
  const routeFile = parts.at(-1);
  if (!routeFile || !/^route\.[cm]?[jt]sx?$/i.test(routeFile)) return undefined;
  const appIndex = parts.lastIndexOf('app');
  if (appIndex === -1) return undefined;
  const segments = parts.slice(appIndex + 1, -1).filter((segment) => !/^\(.+\)$/.test(segment) && !segment.startsWith('@'));
  const normalized = segments.map((segment) => {
    if (/^\[\[?\.\.\..+\]\]?$/.test(segment)) return '*';
    if (/^\[.+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
    return segment;
  });
  return normalizeHttpPath(`/${normalized.join('/')}`);
}

function extractNextRoutes(source: SourceFile, routes: HttpContractEndpoint[]) {
  const file = sourcePath(source);
  const path = nextRoutePath(file);
  if (!path) return;
  const declarations: MorphNode[] = [
    ...source.getFunctions().filter((item) => item.isExported()),
    ...source
      .getVariableDeclarations()
      .filter((item) => item.getVariableStatement()?.isExported())
  ];
  for (const declaration of declarations) {
    const name = Node.isFunctionDeclaration(declaration) || Node.isVariableDeclaration(declaration) ? declaration.getName() : undefined;
    const method = name ? ROUTE_METHODS.get(name.toLowerCase()) : undefined;
    if (!method || method === 'ANY') continue;
    const { line } = location(declaration);
    routes.push(
      endpoint(
        'server',
        method,
        path,
        file,
        line,
        declaration.getStart(),
        'next',
        path.includes(':') || path.includes('*') ? 'pattern' : 'exact',
        handlerContract(declaration)
      )
    );
  }
}

function decoratorPath(node: { getCallExpression(): CallExpression | undefined }) {
  return extractedPath(node.getCallExpression()?.getArguments()[0]) ?? { path: '/', confidence: 'exact' as const };
}

function nestMethodContract(method: MorphNode & { getDecorators(): Array<{ getName(): string; getCallExpression(): CallExpression | undefined }> }) {
  const decorators = method.getDecorators();
  const authRequired = decorators.some((decorator) => /^(UseGuards|Auth|Authenticated|RequireAuth)$/i.test(decorator.getName()));
  const statusDecorator = decorators.find((decorator) => decorator.getName() === 'HttpCode');
  const status = numberLiteral(statusDecorator?.getCallExpression()?.getArguments()[0]);
  const contract = handlerContract(method, authRequired, status ? [status] : []);
  if (!Node.isMethodDeclaration(method)) return contract;
  const bodyFields = new Set(contract.requestFields);
  const responseFields = new Set(contract.responseFields);
  for (const parameter of method.getParameters()) {
    if (!parameter.getDecorators().some((decorator) => decorator.getName() === 'Body')) continue;
    const name = parameter.getName();
    method.forEachDescendant((node) => {
      if (Node.isPropertyAccessExpression(node) && node.getExpression().getText() === name) bodyFields.add(node.getName());
    });
  }
  for (const statement of method.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
    for (const field of objectKeys(statement.getExpression())) responseFields.add(field);
  }
  contract.requestFields = [...bodyFields].sort();
  contract.responseFields = [...responseFields].sort();
  if (contract.statuses.length === 0 && responseFields.size > 0) contract.statuses = [200];
  return contract;
}

function extractNestRoutes(source: SourceFile, routes: HttpContractEndpoint[]) {
  const file = sourcePath(source);
  for (const classDeclaration of source.getClasses()) {
    const controller = classDeclaration.getDecorators().find((decorator) => decorator.getName() === 'Controller');
    if (!controller) continue;
    const prefix = decoratorPath(controller);
    const controllerAuth = classDeclaration
      .getDecorators()
      .some((decorator) => /^(UseGuards|Auth|Authenticated|RequireAuth)$/i.test(decorator.getName()));
    for (const methodDeclaration of classDeclaration.getMethods()) {
      const routeDecorator = methodDeclaration
        .getDecorators()
        .find((decorator) => ROUTE_METHODS.has(decorator.getName().toLowerCase()));
      if (!routeDecorator) continue;
      const method = ROUTE_METHODS.get(routeDecorator.getName().toLowerCase());
      if (!method || method === 'ANY') continue;
      const routePath = decoratorPath(routeDecorator);
      const path = joinHttpPath(prefix.path, routePath.path);
      const { line } = location(methodDeclaration);
      const contract = nestMethodContract(methodDeclaration);
      if (controllerAuth) contract.auth = 'required';
      routes.push(
        endpoint(
          'server',
          method,
          path,
          file,
          line,
          methodDeclaration.getStart(),
          'nest',
          prefix.confidence === 'pattern' || routePath.confidence === 'pattern' ? 'pattern' : 'exact',
          contract
        )
      );
    }
  }
}

function pathSegments(path: string) {
  return path === '/' ? [] : path.replace(/^\//, '').split('/');
}

function pathsMatch(clientPath: string, routePath: string) {
  const clients = pathSegments(clientPath);
  const routes = pathSegments(routePath);
  let i = 0;
  for (; i < routes.length; i += 1) {
    const route = routes[i];
    const client = clients[i];
    if (route === '*') return true;
    if (client === undefined) return false;
    if (route.startsWith(':') || client.startsWith(':')) continue;
    if (route !== client) return false;
  }
  return i === clients.length;
}

function extractTestObservations(source: SourceFile, clients: HttpContractEndpoint[]) {
  const file = sourcePath(source);
  if (!TEST_NAME.test(file)) return [];
  const observations: HttpContractObservation[] = clients
    .filter((client) => client.file === file && client.method !== 'ANY')
    .map((client) => ({
      id: `test:${client.method}:${client.path}:${file}:${client.line}`,
      method: client.method as Exclude<HttpMethod, 'ANY'>,
      path: client.path,
      file,
      line: client.line,
      source: 'test'
    }));
  source.forEachDescendant((node) => {
    if (!Node.isCallExpression(node)) return;
    const expression = node.getExpression();
    if (!Node.isPropertyAccessExpression(expression)) return;
    const method = ROUTE_METHODS.get(expression.getName().toLowerCase());
    if (!method || method === 'ANY') return;
    const base = expression.getExpression();
    if (!Node.isCallExpression(base)) return;
    const runner = base.getExpression().getText();
    if (!/^(request|supertest)$/.test(runner)) return;
    const path = extractedPath(node.getArguments()[0]);
    if (!path) return;
    const { line } = location(node);
    observations.push({
      id: `test:${method}:${path.path}:${file}:${line}:${node.getStart()}`,
      method: method as Exclude<HttpMethod, 'ANY'>,
      path: path.path,
      file,
      line,
      source: 'test'
    });
  });
  return observations;
}

function applyTestCoverage(routes: HttpContractEndpoint[], observations: HttpContractObservation[], issues: HttpContractIssue[]) {
  for (const route of routes) {
    route.coveredBy = observations
      .filter((observation) => pathsMatch(observation.path, route.path) && (route.method === 'ANY' || route.method === observation.method))
      .map((observation) => `${observation.file}:${observation.line}`)
      .sort();
    if (route.coveredBy.length === 0) {
      issues.push({
        kind: 'route-without-test',
        severity: 'warning',
        endpointId: route.id,
        message: `${route.method} ${route.path} chưa có HTTP test observation trong snapshot.`,
        candidates: []
      });
    }
  }
}

function semanticIssues(client: HttpContractEndpoint, route: HttpContractEndpoint): HttpContractIssue[] {
  const issues: HttpContractIssue[] = [];
  const missingRequest = route.contract.requestFields.filter((field) => !client.contract.requestFields.includes(field));
  if (missingRequest.length > 0) {
    issues.push({
      kind: 'request-schema-mismatch',
      severity: 'error',
      endpointId: client.id,
      message: `${client.method} ${client.path} thiếu request field mà handler đọc: ${missingRequest.join(', ')}.`,
      candidates: [route.id]
    });
  }
  if (client.contract.responseFields.length > 0 && route.contract.responseFields.length > 0) {
    const missingResponse = client.contract.responseFields.filter((field) => !route.contract.responseFields.includes(field));
    if (missingResponse.length > 0) {
      issues.push({
        kind: 'response-schema-mismatch',
        severity: 'error',
        endpointId: client.id,
        message: `${client.method} ${client.path} đọc response field server không trả: ${missingResponse.join(', ')}.`,
        candidates: [route.id]
      });
    }
  }
  if (route.contract.auth === 'required' && client.contract.auth === 'absent') {
    issues.push({
      kind: 'missing-auth',
      severity: 'error',
      endpointId: client.id,
      message: `${client.method} ${client.path} gọi route cần auth nhưng không thấy Authorization header.`,
      candidates: [route.id]
    });
  }
  if (client.contract.statuses.length > 0 && route.contract.statuses.length > 0) {
    const unsupported = client.contract.statuses.filter((status) => !route.contract.statuses.includes(status));
    if (unsupported.length > 0) {
      issues.push({
        kind: 'status-mismatch',
        severity: 'error',
        endpointId: client.id,
        message: `${client.method} ${client.path} chờ status ${unsupported.join(', ')} nhưng route phát ${route.contract.statuses.join(', ')}.`,
        candidates: [route.id]
      });
    }
  }
  return issues;
}

function compareEndpoints(clients: HttpContractEndpoint[], routes: HttpContractEndpoint[]) {
  const matches: { clientId: string; routeId: string }[] = [];
  const issues: HttpContractIssue[] = [];
  const matchedRoutes = new Set<string>();

  for (const client of clients) {
    const pathCandidates = routes.filter((route) => pathsMatch(client.path, route.path));
    const methodCandidates = pathCandidates.filter((route) => route.method === 'ANY' || route.method === client.method);
    if (methodCandidates.length > 0) {
      for (const route of methodCandidates) {
        matches.push({ clientId: client.id, routeId: route.id });
        matchedRoutes.add(route.id);
        issues.push(...semanticIssues(client, route));
      }
      continue;
    }
    if (pathCandidates.length > 0) {
      issues.push({
        kind: 'method-mismatch',
        severity: 'error',
        endpointId: client.id,
        message: `${client.method} ${client.path} có route cùng path nhưng khác HTTP method.`,
        candidates: pathCandidates.map((route) => route.id).sort()
      });
    } else {
      issues.push({
        kind: 'missing-route',
        severity: 'error',
        endpointId: client.id,
        message: `${client.method} ${client.path} được client gọi nhưng không thấy backend route tương ứng.`,
        candidates: []
      });
    }
  }

  for (const route of routes) {
    if (matchedRoutes.has(route.id)) continue;
    issues.push({
      kind: 'no-local-consumer',
      severity: 'info',
      endpointId: route.id,
      message: `${route.method} ${route.path} không có consumer trong snapshot local; đây không phải kết luận dead code.`,
      candidates: []
    });
  }

  return { matches, issues };
}

function endpointOrder(a: HttpContractEndpoint, b: HttpContractEndpoint) {
  return a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method) || a.path.localeCompare(b.path);
}

export function contractRadarReport(input: SourceFileInput[]): ContractRadarReport {
  const files = canonicalFiles(input);
  if (files.length === 0) {
    return {
      summary: {
        clientCalls: 0,
        serverRoutes: 0,
        matches: 0,
        missingRoutes: 0,
        methodMismatches: 0,
        requestSchemaMismatches: 0,
        responseSchemaMismatches: 0,
        missingAuth: 0,
        statusMismatches: 0,
        routesWithTests: 0,
        routesWithoutTests: 0,
        noLocalConsumers: 0,
        unknowns: 1
      },
      clients: [],
      routes: [],
      observations: [],
      matches: [],
      issues: [],
      unknowns: [{ side: 'server', file: '', line: 1, expression: '', reason: 'Không có file JavaScript/TypeScript để quét contract.' }],
      limitations: ['Contract Radar MVP chỉ hỗ trợ JavaScript/TypeScript.']
    };
  }

  const project = createProject(files);
  const clients: HttpContractEndpoint[] = [];
  const testClients: HttpContractEndpoint[] = [];
  const routes: HttpContractEndpoint[] = [];
  const unknowns: ContractUnknown[] = [];
  const program = project.getProgram().compilerObject;
  const parseErrorFiles = new Set<string>();

  for (const source of project.getSourceFiles()) {
    const diagnostics = program.getSyntacticDiagnostics(source.compilerNode);
    if (diagnostics.length === 0) continue;
    const file = sourcePath(source);
    parseErrorFiles.add(file);
    unknowns.push({
      side: 'server',
      file,
      line: 1,
      expression: file,
      reason: `File có lỗi cú pháp: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, ' ')}`
    });
  }

  const receivers = collectReceivers(project);
  const drafts: RouteDraft[] = [];
  const mounts: Mount[] = [];
  extractServerRoutes(project, receivers, drafts, mounts, unknowns, parseErrorFiles);
  routes.push(...materializeRoutes(drafts, mounts));

  for (const source of project.getSourceFiles()) {
    if (parseErrorFiles.has(sourcePath(source))) continue;
    extractClients(source, TEST_NAME.test(sourcePath(source)) ? testClients : clients, unknowns);
    extractNextRoutes(source, routes);
    extractNestRoutes(source, routes);
  }

  const sortedClients = clients.sort(endpointOrder);
  const sortedRoutes = [...new Map(routes.map((route) => [route.id, route])).values()].sort(endpointOrder);
  const observations = project
    .getSourceFiles()
    .flatMap((source) => (parseErrorFiles.has(sourcePath(source)) ? [] : extractTestObservations(source, testClients)))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.method.localeCompare(b.method));
  const { matches, issues } = compareEndpoints(sortedClients, sortedRoutes);
  applyTestCoverage(sortedRoutes, observations, issues);
  matches.sort((a, b) => a.clientId.localeCompare(b.clientId) || a.routeId.localeCompare(b.routeId));
  issues.sort((a, b) => a.kind.localeCompare(b.kind) || a.endpointId.localeCompare(b.endpointId));
  unknowns.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.expression.localeCompare(b.expression));

  return {
    summary: {
      clientCalls: sortedClients.length,
      serverRoutes: sortedRoutes.length,
      matches: matches.length,
      missingRoutes: issues.filter((issue) => issue.kind === 'missing-route').length,
      methodMismatches: issues.filter((issue) => issue.kind === 'method-mismatch').length,
      requestSchemaMismatches: issues.filter((issue) => issue.kind === 'request-schema-mismatch').length,
      responseSchemaMismatches: issues.filter((issue) => issue.kind === 'response-schema-mismatch').length,
      missingAuth: issues.filter((issue) => issue.kind === 'missing-auth').length,
      statusMismatches: issues.filter((issue) => issue.kind === 'status-mismatch').length,
      routesWithTests: sortedRoutes.filter((route) => route.coveredBy.length > 0).length,
      routesWithoutTests: sortedRoutes.filter((route) => route.coveredBy.length === 0).length,
      noLocalConsumers: issues.filter((issue) => issue.kind === 'no-local-consumer').length,
      unknowns: unknowns.length
    },
    clients: sortedClients,
    routes: sortedRoutes,
    observations,
    matches,
    issues,
    unknowns,
    limitations: [
      'Kết quả là phân tích tĩnh; wrapper HTTP hoặc route tạo bằng metaprogramming có thể nằm trong unknowns.',
      'No local consumer chỉ nói về snapshot được quét, không có nghĩa route là dead.',
      'Schema được suy luận từ object literal và property access; type alias/validator runtime phức tạp chưa được mở rộng.',
      'Runtime coverage vẫn cần test trace để phân biệt đường có thể chạy với đường đã chạy.'
    ]
  };
}
