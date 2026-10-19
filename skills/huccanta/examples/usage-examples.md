# Usage examples

## Explore an unfamiliar repository

User prompt:

> Use Huccanta to explain this codebase's main call flows and show me the five riskiest functions.

Expected behavior: call `analyze_code` with `limit: 5`, inspect only relevant IDs with `get_function`, and distinguish static evidence from unresolved runtime behavior.

## Evaluate a deletion

User prompt:

> Can we delete `src/legacy.ts` safely?

Expected behavior: inspect import and file-graph evidence for JS/TS, call `simulate_change` with `delete-file`, report affected callers/tests and uncertainty, and avoid declaring the deletion safe solely from static analysis.

## Review a Python project

User prompt:

> Find Python call cycles and explain what will break if I remove this method.

Expected behavior: use `analyze_code`, `get_function`, and `simulate_change`; explain Python's conservative resolver limits. Do not call JS/TS-only tools or claim FastAPI/Django route coverage.

## Check API drift

User prompt:

> Check whether our React client and Express routes still agree after this patch.

Expected behavior: run `contract_radar` on a scope containing both client and server; separate definite errors, warnings, informational no-consumer routes, and unknown dynamic expressions. Recommend integration tests for runtime behavior.

## Verify patch intent

User prompt:

> This refactor may remove `src/old.ts`, but must preserve `src/api.ts#handler` and add no new cycles. Verify it.

Expected behavior: build complete before/after JS/TS snapshots and a policy containing allowed removal, preserved function, and zero new-cycle budgets; call `verify_change`; retain status, evidence, and fingerprint.

## Pre-merge review

User prompt:

> Is this PR safe to merge?

Expected behavior: use relevant Huccanta tools as structural evidence, then check the diff and available build/tests/security checks separately. State missing evidence and provide only a conditional recommendation.
