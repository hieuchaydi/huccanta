import {
  Flag,
  FolderOpen,
  GitBranch,
  Layers3,
  Boxes,
  Maximize2,
  Moon,
  Play,
  RefreshCw,
  Route,
  Save,
  ScanSearch,
  Sun,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { layoutGraph, type LayoutMode, NODE_HEIGHT, nodeWidth } from './layout';
import { type Lang, makeT, type TFn } from './i18n';
import {
  isIgnoredSourcePath,
  isJavaScriptSourcePath,
  isSupportedSourcePath,
  MAX_SOURCE_BYTES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  SOURCE_FILE_ACCEPT
} from './sourceFiles';
import type { ContractRadarReport, FileGraph, Graph, GraphEdge, GraphNode, SourceFileInput } from './types';

const FILE_HUES = ['#3F5BF6', '#12A669', '#C77B00', '#8B5CF6', '#E23D4B', '#0E9AA7', '#0891B2', '#DB2777'];

const SAMPLE: SourceFileInput[] = [
  {
    path: 'auth.js',
    content: `function login(user, pass) {
  const ok = validate(user, pass);
  if (!ok) return null;
  const token = getToken(user);
  audit(user);
  return token;
}

function validate(user, pass) {
  const h = hashPwd(pass);
  if (!user) return false;
  return checkUser(user, h);
}

function hashPwd(pass) {
  return sha256(pass);
}`
  },
  {
    path: 'token.js',
    content: `function getToken(user) {
  const t = createToken(user);
  return refresh(t);
}

function refresh(t) {
  if (expired(t)) {
    if (t.retry < 3) {
      return getToken(t.user);
    }
    return createToken(t.user);
  }
  return t;
}

function createToken(user) {
  return sign(user);
}

function expired(t) {
  return Date.now() > t.exp;
}`
  },
  {
    path: 'util.js',
    content: `function checkUser(user, h) {
  return db(user, h);
}
function sha256(x){ return x; }
function sign(x){ return x; }
function audit(u){ return log(u); }
function db(u, h){ return true; }
function log(x){ return x; }`
  }
];

type ViewBox = { x: number; y: number; s: number };
// Mức đồ thị hiển thị. 'contract' để chỗ trống cho GĐ tương lai (route/OpenAPI), chưa render.
type ViewMode = 'function' | 'file';

// Map FileGraph (mức file) → Graph để tái dùng nguyên bộ layout + renderer SVG hiện có.
function fileGraphToGraph(fg: FileGraph): Graph {
  return {
    nodes: fg.nodes.map((n) => ({
      id: n.path,
      name: n.label,
      file: n.path,
      line: 1,
      code: '',
      body: '',
      complexity: n.imports + n.importedBy,
      fanIn: n.importedBy,
      fanOut: n.imports,
      inCycle: n.inCycle,
      issues: [],
      level: n.inCycle ? 'hot' : n.kind === 'orphan' ? 'warn' : 'ok',
      score: n.importedBy * 2 + n.imports
    })),
    edges: fg.edges.map((e) => ({ from: e.from, to: e.to, cycle: e.cycle }))
  };
}
type DragState =
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  | { kind: 'node'; id: string; x: number; y: number; moved: boolean };

function cloneGraph(graph: Graph): Graph {
  return {
    nodes: graph.nodes.map((node) => ({
      ...node,
      issues: (node.issues ?? []).map((issue) => ({ ...issue }))
    })),
    edges: graph.edges.map((edge) => ({ ...edge }))
  };
}

function graphMaps(graph: Graph) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const out = new Map<string, string[]>();
  const inMap = new Map<string, string[]>();
  graph.nodes.forEach((node) => {
    out.set(node.id, []);
    inMap.set(node.id, []);
  });
  graph.edges.forEach((edge) => {
    out.get(edge.from)?.push(edge.to);
    inMap.get(edge.to)?.push(edge.from);
  });
  return { byId, out, inMap };
}

function traceFrom(graph: Graph, start: string, maxDepth: number) {
  const { out } = graphMaps(graph);
  const nodes = new Set<string>([start]);
  const edges = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];

  while (queue.length) {
    const item = queue.shift()!;
    if (item.depth >= maxDepth) continue;
    for (const next of out.get(item.id) ?? []) {
      edges.add(`${item.id}>${next}`);
      if (!nodes.has(next)) {
        nodes.add(next);
        queue.push({ id: next, depth: item.depth + 1 });
      }
    }
  }
  return { nodes, edges };
}

function traceOrder(graph: Graph, start: string, maxDepth: number) {
  const { out } = graphMaps(graph);
  const result: Array<{ id: string; depth: number; cycle: boolean }> = [];
  const seen = new Set<string>();
  function dfs(id: string, depth: number) {
    const cycle = seen.has(id);
    result.push({ id, depth, cycle });
    if (cycle || depth >= maxDepth) return;
    seen.add(id);
    for (const next of out.get(id) ?? []) dfs(next, depth + 1);
  }
  dfs(start, 0);
  return result;
}

function colorForFile(file: string, files: string[]) {
  const index = Math.max(0, files.indexOf(file));
  return FILE_HUES[index % FILE_HUES.length];
}

function escapeXml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]!));
}

// Lỗi API mang theo `code` ổn định (do server trả) để client dịch qua i18n.
class ApiError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

// Dịch một lỗi bất kỳ thành thông báo: ưu tiên mã lỗi (err.<code>) theo ngôn ngữ đang chọn,
// nếu không có bản dịch thì dùng message thô từ server, cuối cùng là khoá dự phòng.
function errText(error: unknown, t: TFn, fallbackKey = 'status.analyzeFailed') {
  if (error instanceof ApiError && error.code) {
    const key = `err.${error.code}`;
    const translated = t(key);
    if (translated !== key) return translated;
  }
  if (error instanceof Error && error.message) return error.message;
  return t(fallbackKey);
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  const payload = asApiPayload(data);
  if (!response.ok) throw new ApiError(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`, typeof payload.code === 'string' ? payload.code : undefined);
  return data as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  const payload = asApiPayload(data);
  if (!response.ok) throw new ApiError(typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`, typeof payload.code === 'string' ? payload.code : undefined);
  return data as T;
}

async function deleteJson(url: string) {
  const response = await fetch(url, { method: 'DELETE' });
  const data = asApiPayload(await response.json().catch(() => ({})));
  if (!response.ok) throw new ApiError(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`, typeof data.code === 'string' ? data.code : undefined);
}

function asApiPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

// Thư viện project đã lưu trong SQLite (server local)
type SavedProject = { id: string; name: string; source: string; fileCount: number; nodeCount: number; updatedAt: string };
type SavedProjectFull = SavedProject & { files: SourceFileInput[] };
type GitAnalyzeResponse = { graph: Graph; files?: SourceFileInput[]; project?: SavedProject };

/* ---- Lưu bố cục + mốc so sánh vào localStorage (theo chữ ký project) ---- */
const LAYOUT_KEY = 'huccanta:layouts';
const BASELINE_KEY = 'huccanta:baselines';
const LANG_KEY = 'huccanta:lang';
const THEME_KEY = 'huccanta:theme';
const CURRENT_DB = 'huccanta-current-project';
const CURRENT_STORE = 'sessions';
const CURRENT_KEY = 'current';
const CURRENT_VERSION = 1;

type NodeStat = { complexity: number; score: number; level: string; inCycle: boolean };
type Baseline = { at: string; nodes: Record<string, NodeStat>; hot: number; warn: number };
type CurrentSession = {
  version: number;
  graph: Graph;
  files: SourceFileInput[];
  meta: { name: string; source: string };
  status: { nodes: number; edges: number };
  savedAt: string;
};

function signatureOf(graph: Graph) {
  return [...new Set(graph.nodes.map((node) => node.file))].sort().join('|');
}
function readStore(key: string): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}
function writeStore(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* bỏ qua nếu vượt quota */
  }
}
function applySavedLayout(graph: Graph) {
  const saved = readStore(LAYOUT_KEY)[signatureOf(graph)] as Record<string, { x: number; y: number }> | undefined;
  if (!saved) return;
  graph.nodes.forEach((node) => {
    const point = saved[node.id];
    if (point) {
      node.x = point.x;
      node.y = point.y;
    }
  });
}
function persistLayout(graph: Graph) {
  const all = readStore(LAYOUT_KEY);
  all[signatureOf(graph)] = Object.fromEntries(graph.nodes.map((node) => [node.id, { x: node.x ?? 0, y: node.y ?? 0 }]));
  writeStore(LAYOUT_KEY, all);
}
function clearLayout(graph: Graph) {
  const all = readStore(LAYOUT_KEY);
  delete all[signatureOf(graph)];
  writeStore(LAYOUT_KEY, all);
}
function loadBaseline(graph: Graph): Baseline | null {
  return (readStore(BASELINE_KEY)[signatureOf(graph)] as Baseline | undefined) ?? null;
}
function makeBaseline(graph: Graph): Baseline {
  return {
    at: new Date().toLocaleString(),
    nodes: Object.fromEntries(
      graph.nodes.map((node) => [node.id, { complexity: node.complexity, score: node.score, level: node.level, inCycle: node.inCycle }])
    ),
    hot: graph.nodes.filter((node) => node.level === 'hot').length,
    warn: graph.nodes.filter((node) => node.level === 'warn').length
  };
}

function openCurrentDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CURRENT_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CURRENT_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCurrentSession(): Promise<CurrentSession | null> {
  try {
    const db = await openCurrentDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CURRENT_STORE, 'readonly');
      const request = tx.objectStore(CURRENT_STORE).get(CURRENT_KEY);
      request.onsuccess = () => {
        const value = request.result as CurrentSession | undefined;
        resolve(value && (value.version === CURRENT_VERSION || value.version == null) ? value : null);
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch {
    return null;
  }
}

async function clearCurrentSession() {
  try {
    const db = await openCurrentDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CURRENT_STORE, 'readwrite');
      tx.objectStore(CURRENT_STORE).delete(CURRENT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    /* bỏ qua nếu không xoá được session cục bộ */
  }
}

function hasNodeMatch(node: GraphNode, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return `${node.name} ${node.file}`.toLowerCase().includes(q);
}

function ErrorFallback() {
  async function resetSession() {
    await clearCurrentSession();
    window.location.reload();
  }

  return (
    <div className="crash-screen">
      <img src="/logo-hu.svg" alt="" />
      <h1>Huccanta gặp lỗi hiển thị</h1>
      <p>Reload lại trang để khởi động sạch. Project đã import gần nhất vẫn được giữ trong bộ nhớ cục bộ.</p>
      <div className="crash-actions">
        <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        <button className="btn" onClick={() => void resetSession()}>Reset session</button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { crashed: boolean }> {
  state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  render() {
    return this.state.crashed ? <ErrorFallback /> : this.props.children;
  }
}

async function writeCurrentSession(session: CurrentSession) {
  try {
    const db = await openCurrentDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CURRENT_STORE, 'readwrite');
      tx.objectStore(CURRENT_STORE).put(session, CURRENT_KEY);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch {
    /* nếu trình duyệt chặn/vượt quota thì app vẫn chạy bình thường */
  }
}

export function App() {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      return saved === 'en' || saved === 'vi' ? saved : 'vi';
    } catch {
      return 'vi';
    }
  });
  const t = useMemo<TFn>(() => makeT(lang), [lang]);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('function');
  const [fileGraphView, setFileGraphView] = useState<Graph | null>(null);
  const [contractReport, setContractReport] = useState<ContractRadarReport | null>(null);
  const [contractOpen, setContractOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('layered');
  const [groupByFile, setGroupByFile] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [depth, setDepth] = useState(6);
  const [hiddenFiles, setHiddenFiles] = useState<Set<string>>(new Set());
  const [fileFilter, setFileFilter] = useState<string | null>(null);
  const [view, setView] = useState<ViewBox>({ x: 40, y: 20, s: 1 });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch {
      /* dùng theo hệ điều hành nếu storage bị chặn */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [pasteCode, setPasteCode] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [sourceFiles, setSourceFiles] = useState<SourceFileInput[]>([]);
  const [projectMeta, setProjectMeta] = useState<{ name: string; source: string }>({ name: '', source: 'sample' });
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>([]);
  const [mobilePanel, setMobilePanel] = useState<'map' | 'files' | 'inspect'>('map');
  const [nodeQuery, setNodeQuery] = useState('');
  const [onlyIssues, setOnlyIssues] = useState(false);

  useEffect(() => {
    folderInputRef.current?.setAttribute('webkitdirectory', '');
    folderInputRef.current?.setAttribute('directory', '');
    void bootProject();
    void refreshProjects();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* theme vẫn hoạt động trong phiên hiện tại */
    }
  }, [theme]);

  useEffect(() => {
    if (!modalOpen && !contractOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (contractOpen) setContractOpen(false);
      else setModalOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [modalOpen, contractOpen]);

  useEffect(() => {
    document.documentElement.lang = lang;
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* ngôn ngữ vẫn hoạt động trong phiên hiện tại */
    }
  }, [lang]);

  // Đồ thị đang hiển thị: mức hàm (graph) hoặc mức file (fileGraphView). Mọi memo/tương tác render
  // dùng activeGraph; còn session/baseline/save vẫn thao tác trên graph mức hàm.
  const activeGraph = viewMode === 'file' ? fileGraphView : graph;
  const setActiveGraph: React.Dispatch<React.SetStateAction<Graph | null>> =
    viewMode === 'file' ? setFileGraphView : setGraph;

  const files = useMemo(() => [...new Set(activeGraph?.nodes.map((node) => node.file) ?? [])].sort(), [activeGraph]);
  const jsSourceFiles = useMemo(() => sourceFiles.filter((file) => isJavaScriptSourcePath(file.path)), [sourceFiles]);
  const maps = useMemo(() => (activeGraph ? graphMaps(activeGraph) : null), [activeGraph]);
  const trace = useMemo(() => {
    if (!activeGraph || !selected || !tracing) return { nodes: new Set<string>(), edges: new Set<string>() };
    return traceFrom(activeGraph, selected, depth);
  }, [activeGraph, selected, tracing, depth]);

  const visibleNodes = useMemo(() => {
    if (!activeGraph) return [];
    return activeGraph.nodes.filter((node) => {
      if (hiddenFiles.has(node.file)) return false;
      if (onlyIssues && node.level === 'ok') return false;
      return hasNodeMatch(node, nodeQuery);
    });
  }, [activeGraph, hiddenFiles, nodeQuery, onlyIssues]);

  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleEdges = useMemo(() => {
    if (!activeGraph) return [];
    return activeGraph.edges.filter((edge) => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to));
  }, [activeGraph, visibleNodeIds]);

  async function refreshProjects() {
    try {
      setSavedProjects(await getJson<SavedProject[]>('/api/projects'));
    } catch {
      /* bỏ qua nếu chưa lấy được danh sách */
    }
  }

  async function bootProject() {
    const session = await readCurrentSession();
    if (session?.graph?.nodes?.length) {
      const restored = cloneGraph(session.graph);
      applySavedLayout(restored);
      setGraph(restored);
      setBaseline(loadBaseline(restored));
      setSourceFiles(session.files ?? []);
      setProjectMeta(session.meta ?? { name: t('label.sample'), source: 'sample' });
      setSelected(null);
      setHiddenFiles(new Set());
      setFileFilter(null);
      setStatus(t('status.result', {
        label: session.meta?.name ?? t('label.sample'),
        nodes: session.status?.nodes ?? restored.nodes.length,
        edges: session.status?.edges ?? restored.edges.length
      }));
      requestAnimationFrame(() => fitGraph(restored));
      return;
    }
    await analyzeFiles(SAMPLE, t('label.sample'), 'sample');
  }

  async function analyzeFiles(
    inputFiles: SourceFileInput[],
    name: string,
    source: string,
    options: { autoSaveLibrary?: boolean; persistSession?: boolean; notice?: string } = {}
  ) {
    setBusy(true);
    setStatus(t('status.analyzingN', { n: inputFiles.length }));
    try {
      const next = await postJson<Graph>('/api/analyze', { files: inputFiles });
      const laidOut = layoutGraph(cloneGraph(next), layoutMode);
      applySavedLayout(laidOut);
      setGraph(laidOut);
      setBaseline(loadBaseline(laidOut));
      setSourceFiles(inputFiles);
      setProjectMeta({ name, source });
      setViewMode('function');
      setFileGraphView(null);
      setContractReport(null);
      setContractOpen(false);
      setSelected(null);
      setHiddenFiles(new Set());
      setFileFilter(null);
      setNodeQuery('');
      setOnlyIssues(false);
      const resultStatus = t('status.result', { label: name, nodes: next.nodes.length, edges: next.edges.length });
      setStatus(options.notice ? `${resultStatus} · ${options.notice}` : resultStatus);
      if (options.persistSession ?? true) {
        void writeCurrentSession({
          version: CURRENT_VERSION,
          graph: laidOut,
          files: inputFiles,
          meta: { name, source },
          status: { nodes: next.nodes.length, edges: next.edges.length },
          savedAt: new Date().toISOString()
        });
      }
      if (options.autoSaveLibrary ?? source !== 'sample') {
        void saveProjectSnapshot(name, source, inputFiles, next.nodes.length, { silent: true });
      }
      requestAnimationFrame(() => fitGraph(laidOut));
    } catch (error) {
      setStatus(errText(error, t, 'status.analyzeFailed'));
    } finally {
      setBusy(false);
      setModalOpen(false);
    }
  }

  async function saveCurrent() {
    if (!graph || sourceFiles.length === 0) return;
    await saveProjectSnapshot(projectMeta.name || t('label.folder'), projectMeta.source, sourceFiles, graph.nodes.length);
  }

  async function saveProjectSnapshot(
    name: string,
    source: string,
    files: SourceFileInput[],
    nodeCount: number,
    options: { silent?: boolean } = {}
  ) {
    if (files.length === 0) return;
    try {
      const meta = await postJson<SavedProject>('/api/projects', {
        name,
        source,
        files,
        nodeCount
      });
      if (!options.silent) setStatus(t('status.saved', { name: meta.name }));
      void refreshProjects();
    } catch (error) {
      if (!options.silent) setStatus(errText(error, t, 'status.saveFailed'));
    }
  }

  async function openSaved(id: string) {
    try {
      const project = await getJson<SavedProjectFull>(`/api/projects/${id}`);
      await analyzeFiles(project.files, project.name, project.source, { autoSaveLibrary: false });
    } catch (error) {
      setStatus(errText(error, t, 'status.analyzeFailed'));
    }
  }

  async function deleteSaved(id: string, name: string) {
    if (!window.confirm(t('confirm.deleteProject', { name }))) return;
    try {
      await deleteJson(`/api/projects/${id}`);
      setStatus(t('status.deleted', { name }));
      void refreshProjects();
    } catch (error) {
      setStatus(errText(error, t, 'status.deleteFailed'));
    }
  }

  async function analyzeGit() {
    if (!gitUrl.trim()) return;
    setBusy(true);
    setStatus(t('status.cloningGit'));
    try {
      const result = await postJson<GitAnalyzeResponse>('/api/analyze-git', { url: gitUrl.trim() });
      const next = result.graph;
      const gitFiles = result.files ?? [];
      const projectName = result.project?.name ?? t('label.git');
      const laidOut = layoutGraph(cloneGraph(next), layoutMode);
      applySavedLayout(laidOut);
      setGraph(laidOut);
      setBaseline(loadBaseline(laidOut));
      setSourceFiles(gitFiles);
      setProjectMeta({ name: projectName, source: 'git' });
      setViewMode('function');
      setFileGraphView(null);
      setContractReport(null);
      setContractOpen(false);
      setSelected(null);
      setHiddenFiles(new Set());
      setFileFilter(null);
      setNodeQuery('');
      setOnlyIssues(false);
      setStatus(t('status.gitResult', { nodes: next.nodes.length, edges: next.edges.length }));
      void writeCurrentSession({
        version: CURRENT_VERSION,
        graph: laidOut,
        files: gitFiles,
        meta: { name: projectName, source: 'git' },
        status: { nodes: next.nodes.length, edges: next.edges.length },
        savedAt: new Date().toISOString()
      });
      void refreshProjects();
      requestAnimationFrame(() => fitGraph(laidOut));
    } catch (error) {
      setStatus(errText(error, t, 'status.gitFailed'));
    } finally {
      setBusy(false);
      setModalOpen(false);
    }
  }

  async function resetCurrentProject() {
    await clearCurrentSession();
    setBaseline(null);
    setSelected(null);
    setHiddenFiles(new Set());
    setFileFilter(null);
    setNodeQuery('');
    setOnlyIssues(false);
    setStatus(t('status.currentCleared'));
    await analyzeFiles(SAMPLE, t('label.sample'), 'sample', { autoSaveLibrary: false });
  }

  function relayout(nextMode = layoutMode) {
    if (!activeGraph) return;
    clearLayout(activeGraph); // quên vị trí tuỳ chỉnh, xếp lại tự động
    const next = cloneGraph(activeGraph);
    next.nodes.forEach((node) => {
      node.x = undefined;
      node.y = undefined;
    });
    layoutGraph(next, nextMode);
    setActiveGraph(next);
    requestAnimationFrame(() => fitGraph(next));
  }

  // Nạp đồ thị mức file (gọi /api/file-graph một lần, rồi cache). Chỉ khả dụng khi có sourceFiles JS/TS.
  async function loadFileGraph() {
    if (fileGraphView || jsSourceFiles.length === 0) return;
    setBusy(true);
    setStatus(t('status.fileGraphLoading'));
    try {
      const report = await postJson<FileGraph>('/api/file-graph', { files: jsSourceFiles });
      const mapped = layoutGraph(cloneGraph(fileGraphToGraph(report)), layoutMode);
      setFileGraphView(mapped);
      setStatus(t('status.fileGraphResult', { files: report.summary.files, edges: report.summary.edges, cycles: report.summary.cycles }));
      requestAnimationFrame(() => fitGraph(mapped));
    } catch (error) {
      setViewMode('function');
      setStatus(errText(error, t, 'status.analyzeFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function loadContractRadar() {
    if (jsSourceFiles.length === 0) return;
    setBusy(true);
    setStatus(t('status.contractLoading'));
    try {
      const report = await postJson<ContractRadarReport>('/api/contract-radar', { files: jsSourceFiles });
      setContractReport(report);
      setContractOpen(true);
      const errors = report.issues.filter((issue) => issue.severity === 'error').length;
      setStatus(t('status.contractResult', { matches: report.summary.matches, errors, unknowns: report.summary.unknowns }));
    } catch (error) {
      setStatus(errText(error, t, 'status.analyzeFailed'));
    } finally {
      setBusy(false);
    }
  }

  function switchView(mode: ViewMode) {
    if (mode === viewMode) return;
    setViewMode(mode);
    setSelected(null);
    if (mode === 'file') void loadFileGraph();
    else requestAnimationFrame(() => fitGraph(graph));
  }

  function setMark() {
    if (!graph) return;
    const base = makeBaseline(graph);
    setBaseline(base);
    const all = readStore(BASELINE_KEY);
    all[signatureOf(graph)] = base;
    writeStore(BASELINE_KEY, all);
    setStatus(t('status.markSet', { at: base.at }));
  }

  function fitGraph(target = activeGraph) {
    if (!target || !svgRef.current || target.nodes.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const xs = target.nodes.map((node) => node.x ?? 0);
    const ys = target.nodes.map((node) => node.y ?? 0);
    const minX = Math.min(...xs) - 100;
    const maxX = Math.max(...xs) + 100;
    const minY = Math.min(...ys) - 70;
    const maxY = Math.max(...ys) + 70;
    const scale = Math.min(rect.width / Math.max(1, maxX - minX), rect.height / Math.max(1, maxY - minY), 1.35);
    const nextScale = Math.max(0.24, scale);
    setView({
      s: nextScale,
      x: (rect.width - (maxX + minX) * nextScale) / 2,
      y: (rect.height - (maxY + minY) * nextScale) / 2
    });
  }

  function zoom(factor: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = rect.width / 2;
    const my = rect.height / 2;
    setView((prev) => {
      const nextScale = Math.min(2.6, Math.max(0.22, prev.s * factor));
      return {
        s: nextScale,
        x: mx - (mx - prev.x) * (nextScale / prev.s),
        y: my - (my - prev.y) * (nextScale / prev.s)
      };
    });
  }

  function selectNode(id: string) {
    setSelected(id);
    setMobilePanel('inspect');
  }

  async function handleFolderFiles(fileList: FileList | null) {
    if (!fileList) return;
    const picked: File[] = [];
    let total = 0;
    let truncated = false;
    for (const file of Array.from(fileList)) {
      const rel = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
      if (!isSupportedSourcePath(file.name)) continue;
      if (isIgnoredSourcePath(rel)) continue;
      if (file.size > MAX_SOURCE_FILE_BYTES) {
        truncated = true;
        continue;
      }
      if (picked.length >= MAX_SOURCE_FILES || total + file.size > MAX_SOURCE_BYTES) {
        truncated = true;
        continue;
      }
      picked.push(file);
      total += file.size;
    }
    if (folderInputRef.current) folderInputRef.current.value = '';
    if (!picked.length) {
      setStatus(t('status.folderNoSource'));
      return;
    }
    const inputFiles = await Promise.all(
      picked.map(async (file) => ({
        path: (file.webkitRelativePath || file.name).replace(/\\/g, '/'),
        content: await file.text()
      }))
    );
    const folderName = picked[0].webkitRelativePath?.split('/')[0] || t('label.folder');
    await analyzeFiles(inputFiles, folderName, 'folder', {
      notice: truncated ? t('status.folderLimited', { n: picked.length }) : undefined
    });
  }

  function handlePointerDown(event: React.PointerEvent<SVGSVGElement>) {
    const target = event.target as Element;
    const nodeGroup = target.closest<SVGGElement>('[data-node-id]');
    if (nodeGroup) {
      dragRef.current = { kind: 'node', id: nodeGroup.dataset.nodeId!, x: event.clientX, y: event.clientY, moved: false };
    } else {
      dragRef.current = { kind: 'pan', x: event.clientX, y: event.clientY, moved: false };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (!drag || !activeGraph) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;

    if (drag.kind === 'pan') {
      setView((prev) => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
    } else {
      setActiveGraph((current) => {
        if (!current) return current;
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === drag.id
              ? { ...node, x: (node.x ?? 0) + dx / view.s, y: (node.y ?? 0) + dy / view.s }
              : node
          )
        };
      });
    }
    drag.x = event.clientX;
    drag.y = event.clientY;
  }

  function handlePointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const drag = dragRef.current;
    if (drag?.kind === 'node') {
      if (!drag.moved) selectNode(drag.id);
      else
        setActiveGraph((current) => {
          if (current) persistLayout(current); // lưu vị trí mới nhất
          return current;
        });
    }
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleWheel(event: React.WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    setView((prev) => {
      const nextScale = Math.min(2.6, Math.max(0.22, prev.s * factor));
      return {
        s: nextScale,
        x: mx - (mx - prev.x) * (nextScale / prev.s),
        y: my - (my - prev.y) * (nextScale / prev.s)
      };
    });
  }

  if (!graph || !maps || !activeGraph) {
    return (
      <div className="boot">
        <LoadingMark message={status || t('status.loadingSample')} />
      </div>
    );
  }

  const selectedNode = selected ? maps.byId.get(selected) ?? null : null;
  const hotNodes = [...activeGraph.nodes].filter((node) => node.level !== 'ok').sort((a, b) => b.score - a.score);
  const graphSummary = {
    hot: activeGraph.nodes.filter((node) => node.level === 'hot').length,
    warn: activeGraph.nodes.filter((node) => node.level === 'warn').length,
    cycle: activeGraph.nodes.some((node) => node.inCycle)
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark"><img className="brand-logo" src="/logo-hu.svg" alt="" /></span>
          <span className="brand-name">Huccanta</span>
          <span className="tag">{t('app.tag')}</span>
        </div>
        <div className="toolbar">
          <button className="btn primary" onClick={() => setModalOpen(true)} title={t('btn.project.title')}>
            <Upload size={15} /> {t('btn.project')}
          </button>
          <button className="btn" onClick={() => folderInputRef.current?.click()} title={t('btn.folder.title')}>
            <FolderOpen size={15} /> {t('btn.folder')}
          </button>
          <input
            ref={folderInputRef}
            type="file"
            multiple
            accept={SOURCE_FILE_ACCEPT}
            className="hidden-input"
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={(event) => void handleFolderFiles(event.target.files)}
          />
          <select
            className="btn select"
            value={layoutMode}
            onChange={(event) => {
              const nextMode = event.target.value as LayoutMode;
              setLayoutMode(nextMode);
              relayout(nextMode);
            }}
            title={t('layout.title')}
          >
            <option value="layered">{t('layout.layered')}</option>
            <option value="force">{t('layout.force')}</option>
          </select>
          <div className="seg" role="group" title={t('view.title')}>
            <button className={`btn ${viewMode === 'function' ? 'on' : ''}`} onClick={() => switchView('function')}>
              {t('view.function')}
            </button>
            <button
              className={`btn ${viewMode === 'file' ? 'on' : ''}`}
              onClick={() => switchView('file')}
              disabled={jsSourceFiles.length === 0}
              title={jsSourceFiles.length === 0 ? t('view.file.unavailable') : t('view.file.title')}
            >
              <Boxes size={15} /> {t('view.file')}
            </button>
          </div>
          <button
            className={`btn ${contractOpen ? 'on' : ''}`}
            onClick={() => (contractReport ? setContractOpen(true) : void loadContractRadar())}
            disabled={jsSourceFiles.length === 0}
            title={jsSourceFiles.length === 0 ? t('contract.unavailable') : t('contract.button.title')}
          >
            <ScanSearch size={15} /> {t('contract.button')}
          </button>
          <button className={`btn ${groupByFile ? 'on' : ''}`} onClick={() => setGroupByFile((value) => !value)} title={t('btn.group.title')}>
            <Layers3 size={15} /> {t('btn.group')}
          </button>
          <label className="depth-control" title={t('depth.title')}>
            <Route size={15} />
            <input type="range" min="1" max="12" value={depth} onChange={(event) => setDepth(Number(event.target.value))} />
            <span>{depth}</span>
          </label>
          <button className={`btn ${tracing ? 'on' : ''}`} onClick={() => setTracing((value) => !value)} title={t('btn.trace.title')}>
            <Play size={15} /> {t('btn.trace')}
          </button>
          <button className="btn" onClick={() => relayout()} title={t('btn.layout.title')}>
            <RefreshCw size={15} /> {t('btn.layout')}
          </button>
          <button className={`btn ${baseline ? 'on' : ''}`} onClick={setMark} title={t('btn.mark.title')}>
            <Flag size={15} /> {t('btn.mark')}
          </button>
          <button className="btn" onClick={() => void saveCurrent()} disabled={sourceFiles.length === 0} title={t('btn.save.title')}>
            <Save size={15} /> {t('btn.save')}
          </button>
          <button className="btn" onClick={() => void resetCurrentProject()} title={t('btn.clearCurrent.title')}>
            <Trash2 size={15} /> {t('btn.clearCurrent')}
          </button>
        </div>
        <div className="spacer" />
        <div className="status">{busy ? t('status.processing') : status}</div>
        <button className="btn icon-only" onClick={() => setLang(lang === 'vi' ? 'en' : 'vi')} title={t('lang.title')} aria-label={t('lang.title')}>
          {lang === 'vi' ? 'EN' : 'VI'}
        </button>
        <button className="btn icon-only" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('theme.title')} aria-label={t('theme.title')}>
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </header>

      <nav className="mobile-tabs" aria-label="Mobile panels">
        <button className={mobilePanel === 'map' ? 'active' : ''} onClick={() => setMobilePanel('map')}>Map</button>
        <button className={mobilePanel === 'files' ? 'active' : ''} onClick={() => setMobilePanel('files')}>{t('pane.files')}</button>
        <button className={mobilePanel === 'inspect' ? 'active' : ''} onClick={() => setMobilePanel('inspect')}>Info</button>
      </nav>

      <main className={`workspace mobile-${mobilePanel}`}>
        <aside className="pane left-pane">
          <div className="pane-title">{t('pane.files')}</div>
          <div className="file-list">
            {files.map((file) => {
              const count = activeGraph.nodes.filter((node) => node.file === file).length;
              const hidden = hiddenFiles.has(file);
              return (
                <div className={`row ${fileFilter === file ? 'selected' : ''} ${hidden ? 'muted' : ''}`} key={file}>
                  <button
                    className="swatch-button"
                    style={{ background: colorForFile(file, files) }}
                    onClick={() => {
                      const next = new Set(hiddenFiles);
                      if (next.has(file)) next.delete(file);
                      else next.add(file);
                      setHiddenFiles(next);
                    }}
                    title={t('file.toggle.title')}
                    aria-label={t('file.toggle.title')}
                  />
                  <button className="row-main" onClick={() => setFileFilter(fileFilter === file ? null : file)}>
                    <span>{file}</span>
                    <b>{count}</b>
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pane-title">{t('pane.hotspots')}</div>
          <div className="hot-list">
            {hotNodes.length ? hotNodes.map((node) => (
              <button
                key={node.id}
                className={`hot-row ${selected === node.id ? 'selected' : ''}`}
                onClick={() => {
                  selectNode(node.id);
                  centerNode(node);
                }}
              >
                <span className={`chip ${node.level}`}>{node.level === 'hot' ? t('chip.hot') : t('chip.warn')}</span>
                <span>{node.name}</span>
                <b>{node.score}</b>
              </button>
            )) : <div className="empty">{t('hot.none')}</div>}
          </div>
        </aside>

        <section className="canvas-wrap">
          <div className="graph-tools">
            <input
              value={nodeQuery}
              onChange={(event) => setNodeQuery(event.target.value)}
              placeholder={t('search.placeholder')}
              aria-label={t('search.placeholder')}
            />
            <button className={`btn ${onlyIssues ? 'on' : ''}`} onClick={() => setOnlyIssues((value) => !value)}>
              {t('filter.issues')}
            </button>
          </div>
          <svg
            ref={svgRef}
            className="map"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onWheel={handleWheel}
          >
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" />
              </marker>
              <marker id="arrow-cycle" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" />
              </marker>
              <marker id="arrow-trace" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" />
              </marker>
            </defs>
            <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
              {visibleEdges.map((edge) => (
                <EdgeView
                  key={`${edge.from}>${edge.to}`}
                  edge={edge}
                  from={maps.byId.get(edge.from)}
                  to={maps.byId.get(edge.to)}
                  traced={trace.edges.has(`${edge.from}>${edge.to}`)}
                  dimmed={isEdgeDimmed(edge)}
                />
              ))}
              {visibleNodes.map((node) => (
                <NodeView
                  key={node.id}
                  node={node}
                  files={files}
                  selected={selected === node.id}
                  groupByFile={groupByFile}
                  traced={trace.nodes.has(node.id)}
                  dimmed={isNodeDimmed(node)}
                  onActivate={() => {
                    selectNode(node.id);
                    centerNode(node);
                  }}
                />
              ))}
            </g>
          </svg>
          <div className="hint">{tracing ? t('hint.trace') : t('hint.normal')}</div>
          <div className="zoom-bar">
            <button className="btn icon-only" onClick={() => zoom(1.2)} title={t('zoom.in')} aria-label={t('zoom.in')}><ZoomIn size={15} /></button>
            <button className="btn icon-only" onClick={() => zoom(1 / 1.2)} title={t('zoom.out')} aria-label={t('zoom.out')}><ZoomOut size={15} /></button>
            <button className="btn" onClick={() => fitGraph()} title={t('zoom.fit')}><Maximize2 size={15} /> {t('zoom.fit.label')}</button>
          </div>
        </section>

        <aside className="pane right-pane">
          <Inspector
            graph={activeGraph}
            selectedNode={selectedNode}
            maps={maps}
            summary={graphSummary}
            baseline={baseline}
            tracing={tracing}
            traceOrder={selectedNode ? traceOrder(activeGraph, selectedNode.id, depth) : []}
            t={t}
          />
        </aside>
      </main>

      {busy && <div className="loading-overlay"><LoadingMark message={status || t('status.processing')} /></div>}

      {modalOpen && (
        <div className="modal" onClick={(event) => event.target === event.currentTarget && setModalOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="add-project-title">
            <h2 id="add-project-title">{t('modal.addProject')}</h2>
            <div className="add-grid">
              <button className="add-card" onClick={() => folderInputRef.current?.click()}>
                <FolderOpen size={20} />
                <span>{t('modal.pickFolder')}</span>
              </button>
              <div className="git-box">
                <label>
                  <GitBranch size={17} />
                  <input value={gitUrl} onChange={(event) => setGitUrl(event.target.value)} placeholder={t('modal.gitPlaceholder')} />
                </label>
                <button className="btn primary" onClick={() => void analyzeGit()} disabled={busy}>{t('modal.scanGit')}</button>
              </div>
            </div>
            <textarea value={pasteCode} onChange={(event) => setPasteCode(event.target.value)} spellCheck={false} placeholder={t('modal.pastePlaceholder')} />
            <div className="sheet-actions">
              <button className="btn" onClick={() => setModalOpen(false)}>{t('modal.cancel')}</button>
              <button
                className="btn primary"
                disabled={busy || !pasteCode.trim()}
                onClick={() => void analyzeFiles([{ path: 'input.ts', content: pasteCode }], t('label.paste'), 'paste')}
              >
                {t('modal.analyze')}
              </button>
            </div>

            <div className="saved-head">{t('modal.savedProjects')}</div>
            <div className="saved-list">
              {savedProjects.length ? savedProjects.map((project) => (
                <div className="saved-row" key={project.id}>
                  <button className="saved-open" onClick={() => void openSaved(project.id)} title={t('action.open')}>
                    <span className="saved-name">{project.name}</span>
                    <span className="saved-meta">{t('proj.meta', { files: project.fileCount, nodes: project.nodeCount })}</span>
                  </button>
                  <button className="saved-del" onClick={() => void deleteSaved(project.id, project.name)} title={t('action.delete')} aria-label={`${t('action.delete')} ${project.name}`}>
                    <Trash2 size={15} />
                  </button>
                </div>
              )) : <div className="small-empty">{t('modal.noSaved')}</div>}
            </div>
          </div>
        </div>
      )}

      {contractOpen && contractReport && (
        <div className="modal" onClick={(event) => event.target === event.currentTarget && setContractOpen(false)}>
          <ContractRadarSheet report={contractReport} t={t} onClose={() => setContractOpen(false)} />
        </div>
      )}
    </div>
  );

  function centerNode(node: GraphNode) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((prev) => ({
      ...prev,
      x: rect.width / 2 - (node.x ?? 0) * prev.s,
      y: rect.height / 2 - (node.y ?? 0) * prev.s
    }));
  }

  function isNodeDimmed(node: GraphNode) {
    if (fileFilter && node.file !== fileFilter) return true;
    if (tracing && selected && trace.nodes.size && !trace.nodes.has(node.id)) return true;
    return false;
  }

  function isEdgeDimmed(edge: GraphEdge) {
    if (!maps) return true;
    const from = maps.byId.get(edge.from);
    const to = maps.byId.get(edge.to);
    if (!from || !to) return true;
    if (fileFilter && (from.file !== fileFilter || to.file !== fileFilter)) return true;
    if (tracing && selected && trace.edges.size && !trace.edges.has(`${edge.from}>${edge.to}`)) return true;
    return false;
  }
}

function ContractRadarSheet({ report, t, onClose }: { report: ContractRadarReport; t: TFn; onClose: () => void }) {
  const endpoints = new Map([...report.clients, ...report.routes].map((endpoint) => [endpoint.id, endpoint]));
  const errors = report.issues.filter((issue) => issue.severity === 'error');
  const info = report.issues.filter((issue) => issue.severity !== 'error');
  const stats = [
    ['contract.stat.clients', report.summary.clientCalls],
    ['contract.stat.routes', report.summary.serverRoutes],
    ['contract.stat.matches', report.summary.matches],
    ['contract.stat.covered', report.summary.routesWithTests],
    ['contract.stat.errors', errors.length],
    ['contract.stat.unknowns', report.summary.unknowns]
  ] as const;

  return (
    <div className="sheet contract-sheet" role="dialog" aria-modal="true" aria-labelledby="contract-radar-title">
      <div className="contract-head">
        <div>
          <h2 id="contract-radar-title">{t('contract.title')}</h2>
          <p>{t('contract.subtitle')}</p>
        </div>
        <button className="btn" onClick={onClose}>{t('contract.close')}</button>
      </div>

      <div className="contract-stats">
        {stats.map(([label, value]) => (
          <div className="contract-stat" key={label}>
            <b className={label === 'contract.stat.errors' && value > 0 ? 'hot' : ''}>{value}</b>
            <span>{t(label)}</span>
          </div>
        ))}
      </div>

      <section className="contract-section">
        <h3>{t('contract.errors')}</h3>
        {errors.length === 0 ? <div className="contract-clean">{t('contract.clean')}</div> : (
          <div className="contract-list">
            {errors.map((issue, index) => {
              const endpoint = endpoints.get(issue.endpointId);
              return (
                <article className="contract-issue error" key={`${issue.endpointId}:${issue.kind}:${index}`}>
                  <div className="contract-issue-top">
                    <span className="chip hot">{t(`contract.issue.${issue.kind}`)}</span>
                    {endpoint && <code>{endpoint.method} {endpoint.path}</code>}
                  </div>
                  <p>{issue.message}</p>
                  {endpoint && <small>{endpoint.file}:{endpoint.line} · {endpoint.framework}</small>}
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="contract-section contract-columns">
        <div>
          <h3>{t('contract.unknowns')}</h3>
          {report.unknowns.length === 0 ? <div className="small-empty">{t('common.none')}</div> : (
            <div className="contract-list compact">
              {report.unknowns.map((item, index) => (
                <article className="contract-issue unknown" key={`${item.file}:${item.line}:${index}`}>
                  <code>{item.file}:{item.line}</code>
                  <p>{item.reason}</p>
                </article>
              ))}
            </div>
          )}
        </div>
        <div>
          <h3>{t('contract.info')}</h3>
          {info.length === 0 ? <div className="small-empty">{t('common.none')}</div> : (
            <div className="contract-list compact">
              {info.map((issue, index) => {
                const endpoint = endpoints.get(issue.endpointId);
                return (
                  <article className="contract-issue info" key={`${issue.endpointId}:${index}`}>
                    <code>{endpoint ? `${endpoint.method} ${endpoint.path}` : issue.kind}</code>
                    <p>{issue.message}</p>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <details className="contract-limitations">
        <summary>{t('contract.limitations')}</summary>
        <ul>{report.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
      </details>
    </div>
  );
}

function LoadingMark({ message }: { message: string }) {
  return (
    <div className="loading-mark" role="status" aria-live="polite">
      <div className="loading-logo-wrap">
        <span className="loading-orbit" aria-hidden="true" />
        <img className="loading-logo" src="/logo-hu.svg" alt="" />
      </div>
      <div className="loading-text">{message}</div>
    </div>
  );
}

function EdgeView({
  edge,
  from,
  to,
  traced,
  dimmed
}: {
  edge: GraphEdge;
  from?: GraphNode;
  to?: GraphNode;
  traced: boolean;
  dimmed: boolean;
}) {
  if (!from || !to) return null;
  const fromWidth = nodeWidth(from) / 2;
  const toWidth = nodeWidth(to) / 2;
  let x1 = from.x ?? 0;
  let y1 = from.y ?? 0;
  let x2 = to.x ?? 0;
  let y2 = to.y ?? 0;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  x1 += Math.cos(angle) * fromWidth;
  y1 += Math.sin(angle) * (NODE_HEIGHT / 2);
  x2 -= Math.cos(angle) * (toWidth + 8);
  y2 -= Math.sin(angle) * (NODE_HEIGHT / 2 + 6);
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2 - Math.min(42, Math.abs(x2 - x1) * 0.18);
  const className = ['edge', edge.cycle ? 'cycle' : '', traced ? 'trace' : '', dimmed ? 'dimmed' : ''].filter(Boolean).join(' ');
  const marker = traced ? 'arrow-trace' : edge.cycle ? 'arrow-cycle' : 'arrow';
  return <path className={className} d={`M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`} markerEnd={`url(#${marker})`} />;
}

function NodeView({
  node,
  files,
  selected,
  groupByFile,
  traced,
  dimmed,
  onActivate
}: {
  node: GraphNode;
  files: string[];
  selected: boolean;
  groupByFile: boolean;
  traced: boolean;
  dimmed: boolean;
  onActivate: () => void;
}) {
  const width = nodeWidth(node);
  const fileColor = colorForFile(node.file, files);
  const className = ['graph-node', node.level, selected ? 'selected' : '', traced ? 'trace' : '', dimmed ? 'dimmed' : '']
    .filter(Boolean)
    .join(' ');
  const text = node.name.length > 26 ? `${node.name.slice(0, 24)}...` : node.name;
  return (
    <g
      className={className}
      data-node-id={node.id}
      transform={`translate(${(node.x ?? 0) - width / 2},${(node.y ?? 0) - NODE_HEIGHT / 2})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.name}, ${node.file}:${node.line}`}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onActivate();
      }}
    >
      <rect
        className="node-box"
        width={width}
        height={NODE_HEIGHT}
        rx="8"
        style={groupByFile ? { fill: `${fileColor}1F`, stroke: fileColor } : undefined}
      />
      <circle cx="12" cy={NODE_HEIGHT / 2} r="3.8" fill={fileColor} />
      <text x="23" y={NODE_HEIGHT / 2 + 4}>{text}</text>
      {node.inCycle && <text className="cycle-mark" x={width - 18} y={NODE_HEIGHT / 2 + 4}>↺</text>}
    </g>
  );
}

function delta(current: number, base: number) {
  const diff = current - base;
  return { diff, text: `${diff > 0 ? '+' : ''}${diff}`, tone: diff > 0 ? 'hot' : diff < 0 ? 'ok' : undefined };
}

function Inspector({
  graph,
  selectedNode,
  maps,
  summary,
  baseline,
  tracing,
  traceOrder,
  t
}: {
  graph: Graph;
  selectedNode: GraphNode | null;
  maps: ReturnType<typeof graphMaps>;
  summary: { hot: number; warn: number; cycle: boolean };
  baseline: Baseline | null;
  tracing: boolean;
  traceOrder: Array<{ id: string; depth: number; cycle: boolean }>;
  t: TFn;
}) {
  if (!selectedNode) {
    const hotDelta = baseline ? delta(summary.hot, baseline.hot) : null;
    const warnDelta = baseline ? delta(summary.warn, baseline.warn) : null;
    return (
      <div className="inspector">
        <div className="subhead">{t('insp.overview')}</div>
        <Stat label={t('insp.functions')} value={graph.nodes.length} />
        <Stat label={t('insp.calls')} value={graph.edges.length} />
        <Stat label={t('insp.hotspots')} value={summary.hot} tone="hot" />
        <Stat label={t('insp.watch')} value={summary.warn} tone="warn" />
        <Stat label={t('insp.hasCycle')} value={summary.cycle ? t('common.yes') : t('common.no')} tone={summary.cycle ? 'hot' : 'ok'} />
        {baseline && hotDelta && warnDelta && (
          <Section title={t('insp.vsBaseline', { at: baseline.at })}>
            <Stat label={t('insp.hotspots')} value={`${baseline.hot} → ${summary.hot} (${hotDelta.text})`} tone={hotDelta.tone as 'hot' | 'ok' | undefined} />
            <Stat label={t('insp.watch')} value={`${baseline.warn} → ${summary.warn} (${warnDelta.text})`} tone={warnDelta.tone as 'hot' | 'ok' | undefined} />
          </Section>
        )}
        <div className="empty">{t('insp.clickNode')}</div>
      </div>
    );
  }

  const callers = maps.inMap.get(selectedNode.id) ?? [];
  const callees = maps.out.get(selectedNode.id) ?? [];
  const baseNode = baseline?.nodes[selectedNode.id];
  const complexityDelta = baseNode ? delta(selectedNode.complexity, baseNode.complexity) : null;
  const levelText = selectedNode.level === 'hot' ? t('chip.hot') : selectedNode.level === 'warn' ? t('chip.warn') : 'ok';
  return (
    <div className="inspector">
      <h2>{selectedNode.name}() <span className={`chip ${selectedNode.level}`}>{levelText}</span></h2>
      <div className="subhead">{selectedNode.file}:{selectedNode.line}</div>
      <Stat label={t('insp.complexity')} value={selectedNode.complexity} />
      {complexityDelta && complexityDelta.diff !== 0 && (
        <Stat label={t('insp.complexityDelta')} value={complexityDelta.text} tone={complexityDelta.tone as 'hot' | 'ok' | undefined} />
      )}
      {baseline && !baseNode && <Stat label={t('insp.vsBaselineShort')} value={t('insp.newFn')} tone="warn" />}
      <Stat label={t('insp.fanIn')} value={selectedNode.fanIn} />
      <Stat label={t('insp.fanOut')} value={selectedNode.fanOut} />
      <Stat label={t('insp.inCycle')} value={selectedNode.inCycle ? t('common.yes') : t('common.no')} tone={selectedNode.inCycle ? 'hot' : 'ok'} />

      <Section title={t('insp.caller')}>
        {callers.length ? callers.map((id) => <MiniRef key={id} node={maps.byId.get(id)} />) : <div className="small-empty">{t('common.none')}</div>}
      </Section>
      <Section title={t('insp.callee')}>
        {callees.length ? callees.map((id) => <MiniRef key={id} node={maps.byId.get(id)} />) : <div className="small-empty">{t('common.none')}</div>}
      </Section>
      {selectedNode.issues.length > 0 && (
        <Section title={t('insp.whyFlagged')}>
          {selectedNode.issues.map((issue, index) => (
            <div className="reason" key={`${issue.code}-${index}`}>
              {t(`issue.${issue.code}.reason`, issue.value != null ? { n: issue.value } : undefined)}
            </div>
          ))}
        </Section>
      )}
      {selectedNode.issues.length > 0 && (
        <Section title={t('insp.howFix')}>
          {selectedNode.issues.map((issue, index) => (
            <div className={`fix ${issue.fix === 'tangle' ? 'tangle' : issue.fix === 'warn' ? 'warn' : ''}`} key={`${issue.code}-${index}`}>
              {t(`issue.${issue.code}.fix`)}
            </div>
          ))}
        </Section>
      )}
      {tracing && traceOrder.length > 0 && (
        <Section title={t('insp.flow')}>
          <div className="trace-list">
            {traceOrder.map((step, index) => (
              <div key={`${step.id}-${index}`} style={{ paddingLeft: step.depth * 12 }}>
                {index ? '↳ ' : ''}{maps.byId.get(step.id)?.name ?? step.id}(){step.cycle ? ' ↺' : ''}
              </div>
            ))}
          </div>
        </Section>
      )}
      <Section title={t('insp.code')}>
        <pre dangerouslySetInnerHTML={{ __html: escapeXml(selectedNode.code) }} />
      </Section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'hot' | 'warn' | 'ok' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={tone}>{value}</b>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="inspect-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function MiniRef({ node }: { node?: GraphNode }) {
  if (!node) return null;
  return (
    <div className="mini-ref">
      <b>{node.name}</b>
      <span>{node.file}:{node.line}</span>
    </div>
  );
}
