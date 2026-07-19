import express, { type ErrorRequestHandler, type Response } from 'express';
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
import { collectSourceFiles, SourceScanLimitError } from './scan';
import { deleteProject, getProject, listProjects, saveProject, type ProjectMeta } from './db';
import { localOriginGuard, localSecurityHeaders } from './httpSecurity';
import { validateSourceFiles } from './requestValidation';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3030);
const app = express();

app.disable('x-powered-by');
app.use(localSecurityHeaders);
// Chặn website bên ngoài gọi localhost để đọc source/project đã lưu (DNS rebinding/CORS abuse).
app.use(localOriginGuard);
app.use(express.json({ limit: '60mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/analyze', async (req, res) => {
  const files = readFiles(req.body?.files, res);
  if (!files) return;
  try {
    res.json(await analyzeProject(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/import-health', (req, res) => {
  const files = readFiles(req.body?.files, res);
  if (!files) return;
  try {
    res.json(importHealthReport(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/file-graph', (req, res) => {
  const files = readFiles(req.body?.files, res);
  if (!files) return;
  try {
    res.json(fileGraphReport(files));
  } catch (error) {
    res.status(500).json({ code: 'analyzeFailed', error: error instanceof Error ? error.message : 'Phân tích thất bại.' });
  }
});

app.post('/api/simulate', async (req, res) => {
  const files = readFiles(req.body?.files, res);
  if (!files) return;
  const kind = req.body?.kind as ChangeKind | undefined;
  const target = typeof req.body?.target === 'string' ? (req.body.target as string) : '';
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
  const beforeFiles = readFiles(req.body?.beforeFiles, res, 'missingSnapshots');
  if (!beforeFiles) return;
  const afterFiles = readFiles(req.body?.afterFiles, res, 'missingSnapshots');
  if (!afterFiles) return;
  const policy = (req.body?.policy && typeof req.body.policy === 'object'
    ? req.body.policy
    : {}) as ChangeContractPolicy;
  try {
    res.json(await verifyChangeContract(beforeFiles, afterFiles, policy));
  } catch (error) {
    res.status(500).json({ code: 'contractFailed', error: error instanceof Error ? error.message : 'Không kiểm được Change Contract.' });
  }
});

app.post('/api/contract-radar', (req, res) => {
  const files = readFiles(req.body?.files, res);
  if (!files) return;
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

  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'huccanta-git-'));
    await run('git', ['clone', '--depth', '1', '--single-branch', '--no-tags', url, dir]);
    const files = await collectSourceFiles(dir);
    if (files.length === 0) {
      res.status(400).json({ code: 'gitNoSource', error: 'Repo không có file nguồn được hỗ trợ để phân tích.' });
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
    // Trả cả files để File Graph/Contract Radar dùng được ngay, không bắt người dùng mở lại project.
    res.json({ graph, files, project });
  } catch (error) {
    if (error instanceof SourceScanLimitError) {
      res.status(413).json({ code: 'scanLimit', error: error.message });
    } else {
      // Không trả stderr của Git: URL có thể chứa credential và không được phép rò vào response.
      res.status(500).json({ code: 'gitFailed', error: 'Không clone/quét được repo.' });
    }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
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
  const files = readFiles(req.body?.files, res, 'missingFilesSave');
  if (!files) return;
  try {
    const meta = saveProject({
      name: cleanLabel(req.body?.name, 'Project', 160),
      source: cleanLabel(req.body?.source, 'folder', 40),
      files,
      nodeCount: Math.min(10_000_000, Math.max(0, Math.trunc(Number(req.body?.nodeCount) || 0)))
    });
    res.json(meta);
  } catch {
    res.status(500).json({ code: 'saveFailed', error: 'Không lưu được project.' });
  }
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

// Chuẩn hoá lỗi body parser thành JSON có code ổn định để UI dịch được.
app.use(((error, _req, res, next) => {
  const detail = error as { status?: number; type?: string };
  if (detail.type === 'entity.too.large' || detail.status === 413) {
    res.status(413).json({ code: 'requestTooLarge', error: 'Request vượt giới hạn dung lượng.' });
    return;
  }
  if (detail.type === 'entity.parse.failed' || detail.status === 400) {
    res.status(400).json({ code: 'invalidJson', error: 'JSON không hợp lệ.' });
    return;
  }
  next(error);
}) as ErrorRequestHandler);

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

function readFiles(value: unknown, res: Response, missingCode = 'missingFiles'): SourceFileInput[] | null {
  const result = validateSourceFiles(value, missingCode);
  if (result.ok) return result.files;
  res.status(result.status).json({ code: result.code, error: result.error });
  return null;
}

function cleanLabel(value: unknown, fallback: string, maxLength: number) {
  const cleaned = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (cleaned || fallback).slice(0, maxLength);
}

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' }
    });
    let stderr = '';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(new Error(`${command} timed out`));
    }, 120_000);
    timeout.unref();
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-16_384);
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (code === 0) finish();
      else finish(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
