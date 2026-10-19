# Troubleshooting

## The public npm command fails

The audited source is `private: true`, and neither `huccanta-code-flow-visualizer` nor a verified `huccanta-mcp` package was available from the public npm registry during packaging. Clone the repository, run `npm ci`, and configure `node <HUCCANTA_REPO>/bin/huccanta-mcp.mjs <TARGET_PROJECT>`.

## Server will not start

- Confirm `node --version` is 22 or newer.
- Run `npm ci` in the Huccanta checkout.
- Use absolute paths for both the bin and target repository.
- Keep stdout reserved for MCP JSON-RPC; diagnostics belong on stderr.
- Run the command manually to inspect stderr without fabricating a connection result.

## Tools are not discovered

Restart the MCP client after editing its configuration. Confirm the transport is stdio and the process remains running. The expected public tool names are `analyze_code`, `get_function`, `import_health`, `file_graph`, `simulate_change`, `verify_change`, and `contract_radar`.

## No supported source files

Check the configured root and suffixes. Generated/build/dependency directories, `.d.ts`, and unsupported extensions are intentionally ignored. Ensure the MCP process has filesystem permission to read the target.

## Scan limit exceeded

Narrow `path` to a relevant subdirectory. Limits are 1,500 files, 800,000 bytes per file, and 40 MiB total. Do not claim whole-repository coverage after narrowing.

## `get_function` cannot find an ID

Run `analyze_code` on the same source scope and use the exact returned ID. Duplicate names may include a line suffix. Do not guess IDs from names alone.

## Import/file/contract output is empty on a non-JS project

These modes are JS/TS-focused. Use `analyze_code` and `get_function` for supported polyglot analysis and state the reduced coverage.

## Results miss dynamic behavior

This is expected for reflection, runtime dispatch, dynamic imports/routes, dependency injection, or unsupported framework semantics. Treat absence as unresolved and add runtime tests or tracing.

## `verify_change` returns `UNKNOWN`

The change gate is fail-closed when parsing or evidence is incomplete. Correct the snapshots/scope or report the uncertainty. Do not convert unknown to pass. The separate contract CLI's `--allow-unknown` is an explicit waiver and must not be added automatically.

## Dependency audit reports vulnerabilities

Review `npm audit` findings against the actual runtime path and update dependencies through the project's normal maintenance process. Do not automatically run `npm audit fix` or `--force`; those commands can modify the lockfile and introduce breaking changes.

## Agent does not activate the Skill

Verify the layout is `<skills-directory>/huccanta/SKILL.md`, the frontmatter name exactly matches `huccanta`, and reload the agent. Only Codex CLI integration is verified by this package's build process.
