import { describe, expect, it } from 'vitest';
import { analyzeSources } from '../src/analyzer';
import type { SourceFileInput } from '../src/types';

const sample: SourceFileInput[] = [
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

describe('analyzeSources', () => {
  it('builds the sample graph and marks the getToken/refresh cycle', () => {
    const graph = analyzeSources(sample);
    expect(graph.nodes).toHaveLength(13);
    expect(graph.edges).toHaveLength(14);

    const getToken = graph.nodes.find((node) => node.id === 'token.js#getToken');
    const refresh = graph.nodes.find((node) => node.id === 'token.js#refresh');
    expect(getToken?.inCycle).toBe(true);
    expect(refresh?.inCycle).toBe(true);
    expect(graph.edges.filter((edge) => edge.cycle).map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual([
      'token.js#getToken>token.js#refresh',
      'token.js#refresh>token.js#getToken'
    ]);
  });

  it('keeps duplicated function names unique by file and handles expression-body arrows', () => {
    const graph = analyzeSources([
      { path: 'a.ts', content: 'export const ping = (x: number) => x + 1; export function call(){ return ping(1); }' },
      { path: 'b.ts', content: 'export const ping = () => 2; export const use = () => ping();' }
    ]);

    expect(graph.nodes.map((node) => node.id).sort()).toEqual([
      'a.ts#call',
      'a.ts#ping',
      'b.ts#ping',
      'b.ts#use'
    ]);
    expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual([
      'a.ts#call>a.ts#ping',
      'b.ts#use>b.ts#ping'
    ]);
  });

  it('does not attribute a nested function body call to the outer function', () => {
    const graph = analyzeSources([
      {
        path: 'x.js',
        content: `function outer(){
  function inner(){ leaf(); }
  return inner;
}
function leaf(){ return 1; }`
      }
    ]);

    // inner phải là node riêng, và cạnh tới leaf thuộc về inner chứ không phải outer.
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(['x.js#inner', 'x.js#leaf', 'x.js#outer']);
    expect(graph.edges.map((edge) => `${edge.from}>${edge.to}`).sort()).toEqual(['x.js#inner>x.js#leaf']);
    expect(graph.nodes.find((node) => node.id === 'x.js#outer')?.fanOut).toBe(0);
  });
});
