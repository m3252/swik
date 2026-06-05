# Security Policy

`swik` moves agent configuration between Claude Code and Codex, at the project level or — with explicit `--global` — at the home level (allowlisted files only). Treat migration output as sensitive until you review it.

## Supported Data

In scope:

- project instruction files
- project-local MCP server configuration
- project-local skills

Out of scope:

- account credentials
- session files
- private chat history
- cloud-side memories
- source code from proprietary or leaked tools

## Reporting

Please open a private security advisory or contact the maintainers before publishing a vulnerability that could expose secrets or execute unexpected commands.

## Handling Secrets

`swik` never copies literal environment values into target configs or reports. A literal `env` value is written as a `$NAME` reference and listed in the report; you set the actual variable in the target tool's environment.

Backups preserve the original allowlisted source files for rollback, so if your source config already contains literal secrets, the local backup may contain them too. Backups are local only, live under `~/.swik/` (global) or `.swik-backups/` (project), and are `.gitignore`d. When a migration sees literal env values, the report and the CLI print a warning that the backup may preserve them.

The CLI does not verify whether a value is actually a secret. Always review generated config before running migrated agents.

## Global Scope

`--global` operates only on an allowlist: `CLAUDE.md`/`AGENTS.md`, `settings.json#mcpServers`/`config.toml#mcp_servers`, and `skills/`. It never reads or writes `auth.json`, `sessions/`, `state_*.sqlite`, logs, caches, or any other file under `~/.claude` and `~/.codex`.
