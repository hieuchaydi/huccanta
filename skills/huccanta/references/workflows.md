# Agent workflows

## Repository discovery

1. Record the repository root and revision.
2. Call `analyze_code` with a focused `limit`.
3. Separate `hot` functions, warning-level functions, cycles, and ordinary nodes.
4. Call `get_function` only for IDs relevant to the user's question.
5. Report omitted or unresolved relationships as coverage limitations.

## Dependency and import review

For JS/TS repositories:

1. Use `import_health` for unresolved imports, entry points, and possibly-unused evidence.
2. Use `file_graph` when the question concerns dependency direction, orphan classification, or cycles.
3. Cross-check a deletion candidate with `simulate_change` before recommending removal.
4. Do not label a file dead solely because it has no incoming static import.

For other languages, restrict conclusions to `analyze_code`/`get_function` and the documented resolver coverage.

## Refactor impact assessment

1. Analyze the repository and resolve the exact target ID/path.
2. Inspect direct callers/callees for function targets.
3. Call `simulate_change` using `delete-file` or `delete-function`.
4. Summarize broken callers, orphans, affected tests, cycle/hotspot changes, and uncertainty.
5. Treat the simulation as planning evidence. Do not alter source unless the user asks.

## HTTP contract review

1. Confirm the relevant client and server code is JS/TS.
2. Call `contract_radar` on the smallest complete boundary containing both sides.
3. Group definite errors separately from warnings, informational routes, and dynamic unknowns.
4. Trace each conclusion to method/path and source evidence.
5. Recommend runtime or integration tests for behavior the static analyzer cannot prove.

## Before/after change verification

1. Construct complete JS/TS snapshots for the intended scope; do not send only changed lines.
2. Declare permitted removals, required files/functions, and regression budgets in the policy.
3. Call `verify_change` once with before/after snapshots.
4. Preserve its status and fingerprint with the report.
5. Interpret `UNKNOWN` as insufficient evidence, not a pass. A `PASS` covers structural policy only.

## Pre-merge assessment

Use Huccanta as one evidence stream:

1. Analyze hotspots and cycles.
2. Run relevant import/file/contract checks for JS/TS.
3. Verify the proposed structural change when snapshots and intent are available.
4. Separately inspect the diff and run project build/tests, linting, type checks, and appropriate security checks.
5. Report merge readiness only conditionally, listing every performed and missing check.

## CI contract CLI

Huccanta also includes a CLI outside the MCP server:

```console
node <HUCCANTA_REPO>/bin/huccanta-contract.mjs <PROJECT> --json
node <HUCCANTA_REPO>/bin/huccanta-contract.mjs --before <BASE_DIR> --after <HEAD_DIR> --policy <POLICY_JSON> --json
```

Radar mode fails on errors or unknowns unless `--allow-unknown` is explicitly used. Change mode requires both `--before` and `--after`. Exit `0` passes the selected policy, `1` is a completed failing gate, and wrapper errors exit `2`. Do not add `--allow-unknown` automatically.
