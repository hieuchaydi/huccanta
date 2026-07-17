import { performance } from 'node:perf_hooks';
import { analyzeProject } from '../server/analyze';
import { contractRadarReport } from '../server/contractRadar';
import { parseTreeSitter } from '../server/treesitter';
import type { Graph, SourceFileInput } from '../src/types';

const configuredRuns = Number(process.env.BENCHMARK_RUNS ?? 10);
const RUNS = Number.isInteger(configuredRuns) && configuredRuns > 0 ? configuredRuns : 10;

const multiLanguageFixture: SourceFileInput[] = [
  { path: 'python/service.py', content: 'def load(value):\n    if value:\n        return normalize(value)\n    return None\n\ndef normalize(value):\n    return value.strip()\n' },
  { path: 'java/Order.java', content: 'class Order { int total(){ return this.price() + this.tax(); } int price(){ return 1; } int tax(){ return 2; } }' },
  { path: 'go/service.go', content: 'package service\ntype Service struct{}\nfunc (s *Service) Load(){ s.normalize() }\nfunc (s *Service) normalize(){}\n' },
  { path: 'c/service.c', content: 'int normalize(){ return 1; } int load(){ return normalize(); }' },
  { path: 'cpp/service.cpp', content: 'class Service { int load(){ return normalize(); } int normalize(){ return 1; } };' },
  { path: 'csharp/Service.cs', content: 'class Service { int Load(){ return Normalize(); } int Normalize(){ return 1; } }' }
];

const expectedResolution = new Map([
  ['python/service.py#load>python/service.py#normalize', 'same-file'],
  ['java/Order.java#Order.total>java/Order.java#Order.price', 'exact'],
  ['java/Order.java#Order.total>java/Order.java#Order.tax', 'exact'],
  ['go/service.go#Service.Load>go/service.go#Service.normalize', 'exact'],
  ['c/service.c#load>c/service.c#normalize', 'same-file'],
  ['cpp/service.cpp#Service.load>cpp/service.cpp#Service.normalize', 'exact'],
  ['csharp/Service.cs#Service.Load>csharp/Service.cs#Service.Normalize', 'exact']
]);

const ambiguityFixture: SourceFileInput[] = [
  { path: 'ambiguous/a.py', content: 'def helper():\n    return 1\n' },
  { path: 'ambiguous/b.py', content: 'def helper():\n    return 2\n' },
  { path: 'ambiguous/caller.py', content: 'def run():\n    return helper()\n' },
  { path: 'unique/helper.py', content: 'def only_here():\n    return 1\n' },
  { path: 'unique/caller.py', content: 'def run():\n    return only_here()\n' },
  {
    path: 'receiver.java',
    content: `class A { int run(B other){ return other.helper(); } int helper(){ return 1; } }
      class B { int helper(){ return 2; } }`
  },
  {
    path: 'receiver.cpp',
    content: `class B { public: int helper(){ return 2; } };
      class A { public: int helper(){ return 1; } int run(B other){ return other.helper(); } };`
  }
];

const contractFixture: SourceFileInput[] = [
  {
    path: 'client.ts',
    content: `async function load(){
      const response = await fetch('/api/users/42', { headers: { Authorization: 'Bearer token' } });
      if (response.status === 200) return (await response.json()).name;
    }`
  },
  {
    path: 'server.ts',
    content: `import express from 'express';
      const app = express();
      app.get('/api/users/:id', requireAuth, (req, res) => res.status(200).json({ name: req.body.name }));`
  }
];

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function p95(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function checkResolutionGroundTruth(graph: Graph) {
  const actual = new Map(graph.edges.map((edge) => [`${edge.from}>${edge.to}`, edge.resolution]));
  const missing = [...expectedResolution.keys()].filter((key) => !actual.has(key));
  const unexpected = [...actual.keys()].filter((key) => !expectedResolution.has(key));
  const wrongEvidence = [...expectedResolution].filter(([key, resolution]) => actual.get(key) !== resolution);
  if (missing.length || unexpected.length || wrongEvidence.length) {
    throw new Error(`Resolver ground truth failed: ${missing.length} missing, ${unexpected.length} unexpected, ${wrongEvidence.length} wrong evidence labels`);
  }
  return { expected: expectedResolution.size, actual: actual.size };
}

async function measure(label: string, task: (iteration: number) => unknown | Promise<unknown>) {
  await task(-1);
  const samples: number[] = [];
  let result: unknown;
  for (let iteration = 0; iteration < RUNS; iteration += 1) {
    const started = performance.now();
    result = await task(iteration);
    samples.push(performance.now() - started);
  }
  return { label, medianMs: median(samples), p95Ms: p95(samples), result };
}

const multi = await measure('parseTreeSitter · 6 languages / 6 files', () => parseTreeSitter(multiLanguageFixture));
const project = await measure('analyzeProject · 6 languages / 6 files', (iteration) => {
  const files = iteration < 0
    ? multiLanguageFixture
    : multiLanguageFixture.map((file) => ({ ...file, path: `run-${iteration}/${file.path}` }));
  return analyzeProject(files);
});
const radar = await measure('contractRadarReport · 1 client / 1 route', () => contractRadarReport(contractFixture));
const resolution = checkResolutionGroundTruth(multi.result as Graph);
const ambiguous = await parseTreeSitter(ambiguityFixture);
const guardedSources = new Set([
  'ambiguous/caller.py#run',
  'unique/caller.py#run',
  'receiver.java#A.run',
  'receiver.cpp#A.run'
]);
const guarded = [...guardedSources].filter((source) => !ambiguous.edges.some((edge) => edge.from === source));
if (guarded.length !== guardedSources.size) {
  throw new Error(`Resolver evidence guard failed: ${guarded.length}/${guardedSources.size} under-evidenced calls omitted`);
}

console.log(`Huccanta benchmark · ${RUNS} measured iterations + 1 warm-up`);
console.log('Task'.padEnd(52), 'median ms'.padStart(12), 'p95 ms'.padStart(12), 'result'.padStart(18));
for (const item of [multi, project, radar]) {
  const report = item.result as {
    nodes?: unknown[];
    edges?: Array<{ resolution?: string }>;
    summary?: { matches: number };
  };
  const result = report.summary
    ? `${report.summary.matches} matches`
    : `${report.nodes?.length ?? 0} nodes / ${report.edges?.length ?? 0} edges`;
  const resolutions = report.edges?.reduce<Record<string, number>>((counts, edge) => {
    const key = edge.resolution ?? 'legacy';
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  const evidence = resolutions && Object.keys(resolutions).length > 0
    ? ` · ${Object.entries(resolutions).map(([key, count]) => `${key}:${count}`).join(',')}`
    : '';
  console.log(item.label.padEnd(52), item.medianMs.toFixed(2).padStart(12), item.p95Ms.toFixed(2).padStart(12), `${result}${evidence}`.padStart(18));
}
console.log(`Resolver ground truth: PASS · ${resolution.actual}/${resolution.expected} expected edges · 0 unexpected · ${guarded.length}/${guardedSources.size} under-evidenced calls omitted`);
