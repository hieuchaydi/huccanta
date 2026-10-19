# Language and evidence boundaries

## JavaScript and TypeScript

This is Huccanta's deepest coverage. The function analyzer uses ts-morph symbol resolution. Import Health and File Graph use actual static import/export evidence and cover static imports, re-exports, dynamic `import()` and `require()` when the specifier is resolvable. Contract Radar and Change Contract are JS/TS-only.

Remaining limits include dynamic specifiers, runtime dependency injection, reflection, framework/config references, and behavior not represented by source structure.

## Python

The tree-sitter resolver covers function/method definitions, class ownership, `self.method()`, unique same-file calls, and explicit module-scope imports, aliases, and relative imports when they resolve unambiguously.

It does not currently cover wildcard/dynamic/function-scope imports, arbitrary receiver type inference, runtime dispatch, monkey patching, reflection, or FastAPI/Flask/Django contract semantics. Python coverage prioritizes precision over recall.

## Java, Go, C/C++, and C#

These languages use tree-sitter with conservative owner/receiver and unique same-file resolution. Cross-file bare names and ambiguous targets are omitted rather than guessed. Treat the graph as partial static evidence.

## Resolution evidence

Graph edges can carry evidence such as `exact`, `same-file`, or Python `import`. An absent edge is not evidence that no runtime call exists. When a user needs runtime truth, recommend tests, tracing, or profiling outside Huccanta.

## Input and scan limits

- Maximum 1,500 source files.
- Maximum 800,000 bytes per source file.
- Maximum 40 MiB total source.
- Ignored directories include `.git`, `node_modules`, `dist`, `build`, `coverage`, caches, `out`, and `vendor`.
- `.d.ts` files are excluded.

If limits are exceeded, narrow the repository path. Do not split a contract boundary into arbitrary pieces if doing so would invalidate cross-file evidence; explain the tradeoff.

## Public versus roadmap

Publicly implemented: polyglot static function analysis, JS/TS import/file analysis, delete simulation, Contract Radar, Change Contract, MCP stdio server, and contract CLI.

Not complete/public as full capabilities: runtime test overlay, OpenAPI/DB schema contract sources, Python web-framework contracts, arbitrary rename/move/extract simulation, or formal correctness proof.
