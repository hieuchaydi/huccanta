# Huccanta Agent Skill

This package teaches Skill-capable agents to orchestrate Huccanta's existing local MCP server for evidence-based codebase exploration and structural change assessment. The Skill is an integration layer; it does not bundle or replace the Huccanta server.

## Features

- Function/call graph overview and ranked hotspots.
- Function-level callers, callees, source, complexity, and cycle evidence.
- JS/TS import health and file dependency graph analysis.
- In-memory deletion simulation and blast-radius reporting.
- JS/TS HTTP client/server Contract Radar.
- JS/TS before/after Change Contract with policy and fingerprint.

## Prerequisites

- Node.js 22 or newer.
- A local Huccanta checkout with dependencies installed.
- An authorized local repository to analyze.
- A Skill-capable agent with MCP stdio support.

Git is needed to clone Huccanta. The MCP analysis path itself does not require Huccanta's UI or SQLite database.

## Install Huccanta

The audited `1.0.0` source declares the package private and was not available from the public npm registry when this Skill was built. Install from a trusted local checkout:

```console
git clone https://github.com/hieuchaydi/huccanta.git
cd huccanta
npm ci
npm run build
npm test
```

Do not advertise or configure `npx huccanta-mcp` as an install-from-registry workflow until the package is actually published and verified. The local checkout can run its bin directly:

```console
node <ABSOLUTE_HUCCANTA_REPO>/bin/huccanta-mcp.mjs <ABSOLUTE_TARGET_PROJECT>
```

## MCP configuration

Copy [mcp-config.example.json](mcp-config.example.json) and replace both absolute paths. The JSON `mcpServers` shape is suitable only for clients that support that format; consult the client's current documentation.

For Codex TOML configuration:

```toml
[mcp_servers.huccanta]
command = "node"
args = ["<ABSOLUTE_HUCCANTA_REPO>/bin/huccanta-mcp.mjs", "<ABSOLUTE_TARGET_PROJECT>"]
```

For development inside the Huccanta repository, its checked-in `.mcp.json` uses `npx tsx server/mcp.ts .`. That command relies on the checkout's local dependencies and working directory, so it is not the portable marketplace configuration.

Restart the agent and verify that all seven tools are discovered before relying on the integration.

## Install the Skill

Extract the ZIP so the agent's skills directory contains exactly:

```text
huccanta/
  SKILL.md
  README.md
  mcp-config.example.json
  references/
  examples/
```

Agent skill locations differ by product and version. Follow the official instructions for that agent. This package has been integration-tested with Codex CLI only; Claude Code and Cursor require manual verification.

## Usage

Example prompt:

> Use Huccanta to map this repository, inspect the highest-risk functions, simulate deleting `src/legacy.ts`, and explain the evidence and limitations. Do not modify files.

See [examples/usage-examples.md](examples/usage-examples.md) and [references/workflows.md](references/workflows.md).

## Security considerations

- The MCP server reads supported source files recursively beneath the configured or supplied path.
- Scope the server to one authorized project; do not expose a broad home or workspace directory.
- Tool output may contain source code, paths, symbol names, and architecture details.
- Huccanta is local-first, but the surrounding agent may have separate cloud or logging behavior.
- The audited dependency install reported npm audit findings. Review and remediate dependencies before sensitive production deployment; do not run `npm audit fix` automatically because it may change the lockfile or behavior.
- Huccanta is not a SAST replacement, sandbox, runtime tracer, test runner, or formal proof system.

## Version compatibility

This Skill was built against public Huccanta source version `1.0.0`, commit `3c5313f5198aa35a16ba621127c6358721687e84`, Node.js `>=22`, and MCP SDK `^1.29.0`. Re-audit tool schemas and installation when upgrading. The official Agent Skills validator and a real Codex CLI MCP/Skill integration test are part of this package's validation record.

See [references/troubleshooting.md](references/troubleshooting.md) for startup, discovery, scan-limit, and interpretation failures.
