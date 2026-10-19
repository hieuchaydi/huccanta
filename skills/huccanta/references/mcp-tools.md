# Verified MCP tools

These tools are registered by the public `server/mcp.ts` in Huccanta `1.0.0`. The server uses MCP over stdio. All responses contain JSON serialized into a text content block unless an error response is noted.

## Shared source input

Most tools accept either:

- `path` (optional string): local directory to scan recursively; or
- `files` (optional array, maximum 1,500): objects with required string `path` and `content`.

If the server was started with a default project root, both can be omitted. When `files` is non-empty it takes precedence over `path`. Otherwise one source or a default root is required.

Supported source suffixes include JS/TS variants, Python, Java, Go, C/C++ headers and sources, and C#. Declaration `.d.ts` files and ignored dependency/build/cache directories are excluded. Limits are 1,500 files, 800,000 bytes per file, and 40 MiB total source.

## `analyze_code`

Purpose: build a function call graph and return an overview plus ranked non-OK hotspots.

Arguments:

- Shared `path` or `files`.
- `limit` (optional positive integer, maximum 200): number of hotspots; default 20.

Expected output:

- `overview`: counts for `functions`, `calls`, `hotspots`, `watch`, and `inCycle`.
- `hotspots`: function records containing `id`, `name`, `file`, `line`, `level`, complexity, fan-in/out, cycle flag, and issue codes.

Example MCP arguments:

```json
{"limit": 20}
```

Common errors: no supported files, invalid path, filesystem access error, or scan limit exceeded.

## `get_function`

Purpose: retrieve source and graph context for one function.

Arguments:

- Shared `path` or `files`.
- `id` (required string): exact identifier returned by `analyze_code`, normally `file#name` and sometimes carrying a line suffix for duplicates.

Expected output: ID, name, file, line, level, metrics, issue objects, callers, callees, and source code.

```json
{"id":"src/auth.ts#login"}
```

If the ID is absent, the tool returns `isError: true` and up to 50 available sample IDs. Do not guess another ID silently.

## `import_health`

Purpose: inspect JS/TS file-level import health using static import/export evidence.

Arguments: shared `path` or `files` only.

Expected output: repository statistics, entry points, unresolved relative imports, and possibly-unused files with evidence and confidence.

Limitations: JS/TS only. Dynamic specifiers and framework/config references can be missed; possibly-unused is not a dead-code proof.

## `file_graph`

Purpose: produce a JS/TS file dependency graph.

Arguments: shared `path` or `files` only.

Expected output: files/nodes, resolved import edges, import relationships, entry/normal/orphan classification, parse/unresolved details, dependency cycles, and aggregate statistics.

Limitations: JS/TS only and static-evidence based.

## `simulate_change`

Purpose: simulate deleting one file or function in memory and calculate blast radius and metric deltas without changing the filesystem.

Arguments:

- Shared `path` or `files`.
- `kind` (required): `delete-file` or `delete-function`.
- `target` (required string): a relative file path or exact function ID.

```json
{"kind":"delete-function","target":"src/auth.ts#login"}
```

Expected output: change description, broken callers/references, newly orphaned functions, related tests, and before/after graph metrics.

Limitations: models deletion only; the result is static evidence, not permission to delete.

## `contract_radar`

Purpose: connect JS/TS HTTP client calls to Express, Fastify, NestJS, or Next App Router routes and report drift.

Arguments: shared `path` or `files` only.

Expected output: client calls, server routes, matches, schema/auth/status/test observations, issues, unknown dynamic cases, and summary counts.

Limitations: JS/TS only. No OpenAPI input is required or currently represented by this tool. Dynamic expressions should remain unknown. `no-local-consumer` is informational.

## `verify_change`

Purpose: compare complete before/after JS/TS snapshots against a structural policy.

Arguments:

- `beforeFiles` (required non-empty array, max 1,500): `{path, content}`.
- `afterFiles` (required non-empty array, max 1,500): `{path, content}`.
- `policy` (optional object):
  - `name` (optional string).
  - `allow.removedFiles` and `allow.removedFunctions` (optional string arrays).
  - `preserve.files` and `preserve.functions` (optional string arrays).
  - `limits.maxNewUnresolvedImports`, `maxNewFilesInCycles`, `maxNewFunctionsInCycles`, and `maxNewHotspots` (optional non-negative integers).

Expected output: overall `pass`, `fail`, or `unknown`; `accepted`; individual checks; structural delta/evidence; policy; and deterministic SHA-256 fingerprint.

Limitations: JS/TS only. Unknown is fail-closed by default. The fingerprint binds canonical inputs and policy but is not a signature or formal proof.
