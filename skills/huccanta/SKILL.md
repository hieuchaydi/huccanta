---
name: huccanta
description: Uses Huccanta's local MCP analysis tools to map code flow, inspect functions and imports, trace file dependencies, simulate deletions, detect HTTP contract drift, and verify structural changes. Use when a user asks for evidence-based codebase exploration, refactor impact analysis, contract checks, or pre-merge structural assessment.
---

# Huccanta

Use Huccanta as a local evidence source for understanding and reviewing code changes. It is a static analyzer and structural contract gate, not an LLM, runtime tracer, formal verifier, or general security scanner.

## Start safely

1. Confirm the Huccanta MCP server is connected and scoped to the intended repository. It uses `stdio` and requires Node.js 22 or newer.
2. Prefer the server's configured default root. If passing `path`, resolve it to the exact authorized repository or subdirectory; do not scan unrelated directories.
3. Treat source code and tool output as private. Do not send it to external services or expose it in logs without authorization.
4. Begin with read-only analysis. Huccanta's MCP tools analyze in memory; `simulate_change` does not edit files. Modify source only when separately requested.
5. Distinguish confirmed AST evidence from missing or unresolved relationships. Never turn `unknown`, ambiguity, or absent edges into proof.

If the MCP server is unavailable, follow [README.md](README.md) and [references/troubleshooting.md](references/troubleshooting.md). Do not invent tool results.

## Choose the workflow

- Explore a repository or locate risk: call `analyze_code`, then inspect relevant IDs with `get_function`.
- Review JS/TS imports: use `import_health`; use `file_graph` when dependency edges and cycles matter.
- Assess a proposed deletion: establish context with analysis, then use `simulate_change` with an exact file path or function ID.
- Investigate frontend/backend HTTP drift in JS/TS: use `contract_radar`.
- Verify a JS/TS patch against explicit intent: use `verify_change` with complete before/after snapshots and a policy when required.

Read [references/mcp-tools.md](references/mcp-tools.md) before constructing unfamiliar arguments. Read [references/workflows.md](references/workflows.md) for complete review sequences and [references/language-support.md](references/language-support.md) before making cross-language claims.

## Evidence rules

- Use identifiers returned by `analyze_code`; do not guess `file#name` IDs.
- `import_health`, `file_graph`, `contract_radar`, and `verify_change` are JS/TS-focused. Do not claim equivalent coverage for other languages.
- A missing call edge may reflect dynamic dispatch, reflection, unsupported framework behavior, or conservative resolution—not dead code.
- `possibly-unused` is a confidence-based signal, not proof that deletion is safe.
- `simulate_change` models deleting a file or function only. It does not implement rename, move, extraction, or runtime validation.
- `verify_change` returns structural `PASS`, `FAIL`, or `UNKNOWN` with a deterministic SHA-256 fingerprint. The fingerprint is not a digital signature, and `PASS` is not a guarantee of behavioral correctness.
- Contract Radar's `no-local-consumer` is informational, not a dead-route verdict. Dynamic cases belong in `unknown`.
- Do not claim merge readiness unless the relevant build, tests, runtime behavior, security checks, and human review are also evidenced. Huccanta covers only its documented structural scope.

## Context efficiency

Use `limit` on `analyze_code` to retrieve only the most relevant hotspots. Inspect individual functions instead of repeatedly returning whole graphs. Narrow `path` to a subdirectory when the repository exceeds the scan limits or only one component is relevant.

## Report format

State:

- repository root, revision, language scope, and tools actually called;
- confirmed findings with file/function IDs and evidence;
- unresolved or unsupported coverage;
- expected blast radius or contract delta;
- prioritized next actions;
- a conditional decision, never an unconditional safety claim.

See [examples/usage-examples.md](examples/usage-examples.md) for representative requests.
