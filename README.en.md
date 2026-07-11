# Huccanta

A local-first call-flow visualizer for JavaScript/TypeScript codebases.

**[Tiếng Việt](README.md)** · **English**

![Huccanta demo — scan a project, explore the function map, trace flows and inspect hotspots](docs/demo.gif)

Huccanta scans your code, builds a graph of calls between functions, and surfaces the parts that are hard to maintain — call cycles, overly complex functions, tangled dependencies — with hints on how to untangle them. Everything runs locally; there is no external server and your code never leaves your machine.

## Overview

Reading an unfamiliar codebase is slow because control flow is scattered across files. Huccanta turns it into a map: each function is a node, each call a directed edge. From that map it automatically flags:

- **Cycles** — A calls B and B calls back to A (directly or indirectly), so the flow loops.
- **High complexity** — functions with many branches, hard to read and test.
- **High fan-in / fan-out** — too many places depend on one function, or one function reaches out to too many.

Click a node to see the real code, its callers/callees, why it was flagged and how to fix it. Turn on *Trace* to highlight the execution flow from any function, or set a *mark*, edit the code, and compare before/after.

Code can come from: pasted source, a local folder, or a Git repo URL to clone and scan. Scanned projects can be saved for quick reopening.

**Supported languages:** JavaScript/TypeScript (via ts-morph, with accurate symbol resolution) and **Python, Java, Go, C/C++, C#** (via tree-sitter). For the tree-sitter set, calls are matched by function name (a heuristic), so resolution is less precise than for JS/TS.

## Requirements

- **Node.js ≥ 22** (the server uses `node:sqlite`, a built-in available only from Node 22).
- Git — only needed for the scan-from-URL feature.

## Install & run

```bash
npm install
npm run dev
```

`npm run dev` runs two local processes side by side: the UI (Vite) on port `5173` and the Analyzer API (Express) on port `3030`. Open `http://127.0.0.1:5173`.

The production build serves both from a single port:

```bash
npm run build     # type-check + bundle into dist/
npm run start     # server serves the UI + API at http://127.0.0.1:3030
npm test          # run unit tests (vitest)
```

Override the API port with `PORT`, and the SQLite file location with `HUCCANTA_DB`.

## Usage

1. Click **Project** to paste code / a Git URL, or **Folder** to pick a directory. A sample project loads on first run.
2. Read the map: red border = in a cycle, yellow = worth watching, green = fine.
3. Click a node to open its code, callers/callees, reasons and fixes.
4. Turn on **Trace** and pick a function to see its execution flow; adjust depth with the slider.
5. Set a **mark**, edit code, re-analyze to see how hotspots and complexity changed.
6. Click **Save** to store the project locally; reopen it from the *Saved projects* list.

## Internationalization (i18n)

The UI ships in **Vietnamese** and **English**, switched with the VI/EN button in the toolbar. The choice is remembered across sessions.

The i18n mechanism is small, hand-written and dependency-free — in [src/i18n.ts](src/i18n.ts):

- Each language is a flat `key → string` dictionary. `makeT(lang)` returns a translator `t(key, params?)`.
- Parameter interpolation uses `{name}` syntax:

  ```ts
  const t = makeT('en');
  t('status.result', { label: 'auth', nodes: 13, edges: 14 });
  // → "auth: 13 functions, 14 calls"
  ```

- A missing key in the current language **falls back to Vietnamese**, then to the `key` itself (it never crashes on a missing string).

A key design choice: **the server never returns translated strings.** Hotspots and API errors travel as **codes** (`issue.<code>`, `err.<code>`); the client translates them into the active language. So switching language needs no re-analysis.

**Add a string:** add the same `key` to **both** the `vi` and `en` dictionaries, then use `t('key')`.
**Add a language:** add its code to `type Lang` and the `LANGS` array, create a new dictionary (copy all keys from `vi`), and register it in `dict`.

## MCP server

Huccanta exposes its analyzer over the **Model Context Protocol** so AI agents (Claude Code, Cursor…) can call it directly in natural language, reusing the exact same multi-language analyzer as the app.

The MCP server ships as a **packet usable from any project** — just point it at the folder to analyze:

```bash
npx huccanta-mcp /path/to/your/project   # run as a standalone tool (stdio)
npm run mcp                              # or run it inside this repo
```

Two tools ([server/mcp.ts](server/mcp.ts)):

| Tool | What it does |
|---|---|
| `analyze_code` | Scans a `path` (local folder) or inline `files`; returns an overview (functions, calls, hotspots, cycles) plus ranked hotspots. When launched with a folder (`npx huccanta-mcp <folder>`), the arguments can be omitted. |
| `get_function` | Detail of one function by `id` (`file#name`): code, callers, callees, issues. |

Configure it in an MCP client (e.g. Claude Code):

```json
{
  "mcpServers": {
    "huccanta": { "command": "npx", "args": ["huccanta-mcp", "/path/to/your/project"] }
  }
}
```

## Project layout

```text
src/
  App.tsx        UI: toolbar, files/hotspots panel, SVG map, inspector
  analyzer.ts    Parse AST (ts-morph) → graph + hotspot scoring (SCC, complexity, fan-in/out)
  layout.ts      Layered / force layout
  types.ts       Data contract: Graph / Node / Edge / Issue
  i18n.ts        Vietnamese/English dictionaries + translator
server/
  analyze.ts     Multi-language entry: split JS/TS ↔ tree-sitter, merge + score
  treesitter.ts  tree-sitter parser (Python/Java/Go/C/C++/C#) → graph
  index.ts       Local Express API; serves dist/ in production
  db.ts          Save projects to SQLite (node:sqlite)
  scan.ts        Scan folders/repos, filter source files
  mcp.ts         MCP server (stdio) exposing the analyzer to AI agents
bin/
  huccanta-mcp.mjs   `npx huccanta-mcp <folder>` — run the MCP server from any project
tests/
  analyzer.test.ts, multilang.test.ts
```

## Tech

React 18 · TypeScript · Vite 6 · Express · ts-morph · tree-sitter (WASM) · SQLite (`node:sqlite`) · MCP SDK · Vitest.

For architecture, algorithms and development conventions, see [CLAUDE.md](CLAUDE.md). For the contribution & release workflow, see [CONTRIBUTING.md](CONTRIBUTING.md).
