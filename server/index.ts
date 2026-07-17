import cors from 'cors';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { analyzeProject } from './analyze';
import { importHealthReport } from './importHealth';
import { fileGraphReport } from './fileGraph';
import { simulateChange } from './simulate';
import { verifyChangeContract } from './changeContract';
import { contractRadarReport } from './contractRadar';
import type { ChangeContractPolicy, ChangeKind, SourceFileInput } from '../src/types';
import { collectSourceFiles } from './scan';
import { deleteProject, getProject, listProjects, saveProject, type ProjectMeta } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3030);
const app = express();

app.use(cors());
app.use(express.json({ limit: '60mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/analyze', async (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  try {
    res.json(await analyzeProject(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/import-health', (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  try {
    res.json(importHealthReport(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/file-graph', (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  try {
    res.json(fileGraphReport(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/simulate', async (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  const kind = req.body?.kind as ChangeKind | undefined;
  const target = typeof req.body?.target === 'string' ? (req.body.target as string) : '';
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  if ((kind !== 'delete-file' && kind !== 'delete-function') || !target) {
    res.status(400).json({ code: 'invalidChange', error: 'Cần "kind" (delete-file|delete-function) và "target".' });
    return;
  }
  try {
    res.json(await simulateChange(files, { kind, target }));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/change-contract', async (req, res) => {
  const beforeFiles = req.body?.beforeFiles as SourceFileInput[] | undefined;
  const afterFiles = req.body?.afterFiles as SourceFileInput[] | undefined;
  const policy = (req.body?.policy && typeof req.body.policy === 'object'
    ? req.body.policy
    : {}) as ChangeContractPolicy;
  if (!Array.isArray(beforeFiles) || beforeFiles.length === 0 || !Array.isArray(afterFiles) || afterFiles.length === 0) {
    res.status(400).json({ code: 'missingSnapshots', error: 'Cần cả beforeFiles và afterFiles để kiểm Change Contract.' });
    return;
  }
  try {
    res.json(await verifyChangeContract(beforeFiles, afterFiles, policy));
  } catch (error) {
    res.status(500).json({ code: 'contractFailed', error: error instanceof Error ? error.message : 'Không kiểm được Change Contract.' });
  }
});

app.post('/api/contract-radar', (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFiles', error: 'Thiếu danh sách files để phân tích.' });
    return;
  }
  try {
    res.json(contractRadarReport(files));
  } catch (error) {
    res.status(500).json({ code: 'contractRadarFailed', error: error instanceof Error ? error.message : 'Không quét được HTTP contract.' });
  }
});

app.post('/api/analyze-git', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\/|^git@/.test(url)) {
    res.status(400).json({ code: 'invalidGitUrl', error: 'URL Git không hợp lệ.' });
    return;
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'huccanta-git-'));
  try {
    await run('git', ['clone', '--depth', '1', url, dir]);
    const files = await collectSourceFiles(dir);
    if (files.length === 0) {
      res.status(400).json({ code: 'gitNoSource', error: 'Repo không có file JS/TS hợp lệ để phân tích.' });
      return;
    }
    const graph = await analyzeProject(files);
    // Repo có sẵn tên + file → tự lưu vào DB để mở lại sau.
    let project: ProjectMeta | undefined;
    try {
      project = saveProject({ name: repoName(url), source: 'git', files, nodeCount: graph.nodes.length });
    } catch {
      /* lưu thất bại thì vẫn trả kết quả phân tích */
    }
    // Client mong { graph, project } (xem GitAnalyzeResponse).
    res.json({ graph, project });
  } catch (error) {
    res.status(500).json({ code: 'gitFailed', error: error instanceof Error ? error.message : 'Không clone/quét được repo.' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Thư viện project đã lưu (SQLite local) ----
app.get('/api/projects', (_req, res) => {
  res.json(listProjects());
});

app.get('/api/projects/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) {
    res.status(404).json({ code: 'projectNotFound', error: 'Không tìm thấy project.' });
    return;
  }
  res.json(project);
});

app.post('/api/projects', (req, res) => {
  const files = req.body?.files as SourceFileInput[] | undefined;
  if (!Array.isArray(files) || files.length === 0) {
    res.status(400).json({ code: 'missingFilesSave', error: 'Thiếu danh sách files để lưu.' });
    return;
  }
  const meta = saveProject({
    name: String(req.body?.name ?? 'Project'),
    source: String(req.body?.source ?? 'folder'),
    files,
    nodeCount: Number(req.body?.nodeCount) || 0
  });
  res.json(meta);
});

app.delete('/api/projects/:id', (req, res) => {
  deleteProject(req.params.id);
  res.json({ ok: true });
});

// Production: nếu đã build, phục vụ luôn bản tĩnh dist/ → chạy một cổng duy nhất.
const distDir = path.join(here, '..', 'dist');
const servingApp = existsSync(distDir);
if (servingApp) {
  app.use(express.static(distDir));
  // SPA fallback cho mọi đường dẫn không phải /api
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

const server = app.listen(PORT, '127.0.0.1', () => {
  const what = servingApp ? 'Huccanta (app + API)' : 'Huccanta analyzer API';
  console.log(`${what} listening on http://127.0.0.1:${PORT}`);
});

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close the old Huccanta server or set PORT=3031.`);
    process.exit(1);
  }
  throw error;
});

function repoName(url: string) {
  const cleaned = url.replace(/\.git$/, '').replace(/\/+$/, '');
  const last = cleaned.split(/[/:]/).pop();
  return last && last.length ? last : 'git-repo';
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
