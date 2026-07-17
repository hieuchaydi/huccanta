import { describe, expect, it } from 'vitest';
import { contractRadarReport } from '../server/contractRadar';
import type { SourceFileInput } from '../src/types';

describe('contractRadarReport', () => {
  it('nối fetch literal với Express route có path param', () => {
    const files: SourceFileInput[] = [
      { path: 'src/client.ts', content: `export const load = () => fetch('/api/users/42');` },
      {
        path: 'src/server.ts',
        content: `import express from 'express';\nconst app = express();\napp.get('/api/users/:id', (_req, res) => res.json({}));`
      }
    ];

    const result = contractRadarReport(files);

    expect(result.summary).toMatchObject({ clientCalls: 1, serverRoutes: 1, matches: 1, missingRoutes: 0 });
    expect(result.matches).toHaveLength(1);
    expect(result.routes[0]).toMatchObject({ method: 'GET', path: '/api/users/:id', framework: 'express' });
  });

  it('phân biệt method mismatch với missing route', () => {
    const files: SourceFileInput[] = [
      { path: 'client.ts', content: `fetch('/api/users', { method: 'POST' });\nfetch('/api/missing');` },
      { path: 'server.ts', content: `import express from 'express';\nconst app = express();\napp.get('/api/users', handler);` }
    ];

    const result = contractRadarReport(files);

    expect(result.summary.methodMismatches).toBe(1);
    expect(result.summary.missingRoutes).toBe(1);
    expect(result.issues.find((issue) => issue.kind === 'method-mismatch')?.candidates).toHaveLength(1);
    expect(result.issues.find((issue) => issue.kind === 'missing-route')?.message).toContain('GET /api/missing');
  });

  it('ghép router mount xuyên file và match template URL', () => {
    const files: SourceFileInput[] = [
      {
        path: 'src/routes.ts',
        content: `import { Router } from 'express';\nconst router = Router();\nrouter.get('/users/:id', handler);\nexport default router;`
      },
      {
        path: 'src/server.ts',
        content: `import express from 'express';\nimport users from './routes';\nconst app = express();\napp.use('/api', users);`
      },
      { path: 'src/client.ts', content: 'export const load = (id: string) => fetch(`/api/users/${id}`);' }
    ];

    const result = contractRadarReport(files);

    expect(result.routes.map((route) => route.path)).toEqual(['/api/users/:id']);
    expect(result.clients[0]).toMatchObject({ path: '/api/users/:dynamic', confidence: 'pattern' });
    expect(result.summary.matches).toBe(1);
    expect(result.summary.unknowns).toBe(0);
  });

  it('đọc Next App Router và Axios client', () => {
    const files: SourceFileInput[] = [
      { path: 'src/app/api/users/[id]/route.ts', content: `export async function DELETE(){ return new Response(null); }` },
      { path: 'src/deleteUser.ts', content: `import axios from 'axios';\nexport const remove = () => axios.delete('/api/users/7');` }
    ];

    const result = contractRadarReport(files);

    expect(result.routes[0]).toMatchObject({ method: 'DELETE', path: '/api/users/:id', framework: 'next' });
    expect(result.clients[0]).toMatchObject({ method: 'DELETE', framework: 'axios' });
    expect(result.summary.matches).toBe(1);
  });

  it('đưa URL động vào unknown thay vì báo missing giả', () => {
    const files: SourceFileInput[] = [{ path: 'client.ts', content: `export function load(url: string){ return fetch(url); }` }];

    const result = contractRadarReport(files);

    expect(result.summary.clientCalls).toBe(0);
    expect(result.summary.missingRoutes).toBe(0);
    expect(result.summary.unknowns).toBe(1);
    expect(result.unknowns[0]).toMatchObject({ side: 'client', reason: 'URL fetch là biểu thức động.' });
  });

  it('output ổn định khi thứ tự input thay đổi', () => {
    const files: SourceFileInput[] = [
      { path: 'b.ts', content: `fetch('/health');` },
      { path: 'a.ts', content: `import express from 'express'; const app = express(); app.get('/health', handler);` }
    ];

    expect(contractRadarReport(files)).toEqual(contractRadarReport([...files].reverse()));
  });

  it('bắt request/response schema, auth và status drift trên route đã match', () => {
    const files: SourceFileInput[] = [
      {
        path: 'client.ts',
        content: `async function create(){
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Ada' })
          });
          if (response.status === 200) console.log('ok');
          const data = await response.json();
          return data.email;
        }`
      },
      {
        path: 'server.ts',
        content: `import express from 'express';
          const app = express();
          app.post('/api/users', requireAuth, (req, res) => {
            const name = req.body.name;
            const email = req.body.email;
            return res.status(201).json({ id: 1, name });
          });`
      }
    ];

    const result = contractRadarReport(files);
    const kinds = result.issues.map((issue) => issue.kind);

    expect(result.summary.matches).toBe(1);
    expect(kinds).toEqual(expect.arrayContaining([
      'request-schema-mismatch',
      'response-schema-mismatch',
      'missing-auth',
      'status-mismatch'
    ]));
    expect(result.summary).toMatchObject({
      requestSchemaMismatches: 1,
      responseSchemaMismatches: 1,
      missingAuth: 1,
      statusMismatches: 1
    });
  });

  it('hiểu axios.create baseURL và contract khớp đầy đủ', () => {
    const files: SourceFileInput[] = [
      {
        path: 'client.ts',
        content: `import axios from 'axios';
          const api = axios.create({ baseURL: '/api' });
          async function create(){
            const response = await api.post('/users', { name: 'Ada', email: 'a@b.c' }, {
              headers: { Authorization: 'Bearer token' }
            });
            if (response.status === 201) console.log(response.data.id);
            return response.data.name;
          }`
      },
      {
        path: 'server.ts',
        content: `import express from 'express'; const app = express();
          app.post('/api/users', requireAuth, (req, res) => {
            const name = req.body.name; const email = req.body.email;
            return res.status(201).json({ id: 1, name });
          });`
      }
    ];

    const result = contractRadarReport(files);

    expect(result.clients[0]).toMatchObject({ path: '/api/users', framework: 'axios' });
    expect(result.clients[0].contract).toMatchObject({ auth: 'present', statuses: [201] });
    expect(result.summary.matches).toBe(1);
    expect(result.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
  });

  it('đọc NestJS controller decorators và body/auth/status contract', () => {
    const files: SourceFileInput[] = [
      {
        path: 'client.ts',
        content: `fetch('/api/users', {
          method: 'POST', headers: { Authorization: 'Bearer x' },
          body: JSON.stringify({ name: 'Ada' })
        });`
      },
      {
        path: 'users.controller.ts',
        content: `@Controller('/api/users')
          @UseGuards(AuthGuard)
          class UsersController {
            @Post()
            @HttpCode(201)
            create(@Body() body: any) { return { id: 1, name: body.name }; }
          }`
      }
    ];

    const result = contractRadarReport(files);

    expect(result.routes[0]).toMatchObject({ framework: 'nest', method: 'POST', path: '/api/users' });
    expect(result.routes[0].contract).toMatchObject({ auth: 'required', requestFields: ['name'], statuses: [201] });
    expect(result.summary.matches).toBe(1);
  });

  it('ghép prefix của Fastify plugin xuyên file', () => {
    const files: SourceFileInput[] = [
      {
        path: 'plugin.ts',
        content: `export default async function users(fastify) {
          fastify.get('/users/:id', async (_request, reply) => reply.code(200).send({ id: 1 }));
        }`
      },
      {
        path: 'server.ts',
        content: `import fastify from 'fastify'; import users from './plugin';
          const app = fastify(); app.register(users, { prefix: '/api' });`
      },
      { path: 'client.ts', content: `fetch('/api/users/7');` }
    ];

    const result = contractRadarReport(files);

    expect(result.routes[0]).toMatchObject({ framework: 'fastify', path: '/api/users/:id' });
    expect(result.summary.matches).toBe(1);
  });

  it('phủ HTTP test observation lên route và chỉ cảnh báo route chưa test', () => {
    const files: SourceFileInput[] = [
      {
        path: 'server.ts',
        content: `import express from 'express'; const app = express();
          app.get('/api/covered/:id', handler); app.post('/api/uncovered', handler); export { app };`
      },
      {
        path: 'server.test.ts',
        content: `import request from 'supertest'; import { app } from './server';
          test('covered', async () => { await request(app).get('/api/covered/7'); });`
      }
    ];

    const result = contractRadarReport(files);

    expect(result.observations).toHaveLength(1);
    expect(result.summary).toMatchObject({ routesWithTests: 1, routesWithoutTests: 1 });
    expect(result.routes.find((route) => route.path === '/api/covered/:id')?.coveredBy).toEqual(['server.test.ts:2']);
    expect(result.issues.filter((issue) => issue.kind === 'route-without-test')).toHaveLength(1);
  });

  it('không tính HTTP call trong test là consumer ứng dụng', () => {
    const files: SourceFileInput[] = [
      {
        path: 'server.ts',
        content: `import express from 'express'; const app = express(); app.get('/api/health', handler);`
      },
      {
        path: 'client.test.ts',
        content: `test('health', async () => { await fetch('/api/health'); });`
      }
    ];

    const result = contractRadarReport(files);

    expect(result.summary).toMatchObject({ clientCalls: 0, matches: 0, routesWithTests: 1, noLocalConsumers: 1 });
    expect(result.observations).toHaveLength(1);
    expect(result.issues.map((issue) => issue.kind)).toContain('no-local-consumer');
  });
});
