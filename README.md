# ai-switch

`ai-switch` is a small CLI for moving project-level agent context between Claude Code and Codex.

It focuses on files that belong to the project:

- instructions: `CLAUDE.md` and `AGENTS.md`
- MCP server settings: `.mcp.json`, `.claude/settings.json`, `.codex/config.toml`
- local skills: `.claude/skills` and `.codex/skills`

It does not migrate accounts, sessions, remote chat history, or secrets outside the project.

This repository is built from public behavior and project file formats only. Do not copy proprietary, leaked, or reverse-engineered source code into this project.

## Install

During development:

```sh
node ./src/cli.js --help
```

With Bun once it is installed:

```sh
bun run src/cli.js --help
bun run src/cli.js convert cc codex --dry-run
```

Later package targets:

```sh
bunx @seungchan/ai-switch
npm install -g @seungchan/ai-switch
brew install m3252/tap/ai-switch
```

## Usage

Inspect a project:

```sh
ai-switch status
ai-switch detect
ai-switch doctor
```

Example status output:

```text
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

Inspect global agent settings:

```sh
ai-switch status --global
```

Global status is read-only and looks at home-level config only:

```text
Claude Code  CLAUDE.md, 2 MCP servers (~/.claude/settings.json), 1 skill
Codex        AGENTS.md, 1 MCP server (~/.codex/config.toml), no skills
```

When `CLAUDE_CONFIG_DIR` or `CODEX_HOME` is set, global status follows those provider-specific locations instead of assuming `~/.claude` and `~/.codex`.

Preview a migration:

```sh
ai-switch convert cc codex --dry-run
ai-switch convert codex cc --dry-run
```

Write changes:

```sh
ai-switch convert cc codex --yes
ai-switch convert codex cc --yes
```

Every write creates a timestamped backup in `.ai-switch-backups/`. Existing target files are not overwritten unless you pass `--force`; `.codex/config.toml` is the exception because migrations preserve existing content and append only new non-conflicting MCP servers.

List and restore backups:

```sh
ai-switch backups
ai-switch restore latest
ai-switch restore <timestamp>
```

## Quick Demo

Preview Claude Code to Codex migration using the bundled example:

```sh
node src/cli.js convert cc codex --dry-run --cwd examples/claude-project
```

Dry runs show what will happen before any file is written:

```text
create        AGENTS.md
manual-review mcp: linear (Only stdio command/args/env servers are converted automatically. Found fields: type, url.)
create        .codex/config.toml
copy          .claude/skills -> .codex/skills
report        ai-switch-report.md
```

Copy an example to a temporary directory and write the migration:

```sh
tmpdir=$(mktemp -d)
cp -R examples/claude-project/. "$tmpdir"
node src/cli.js convert cc codex --yes --cwd "$tmpdir"
cat "$tmpdir/.codex/config.toml"
cat "$tmpdir/ai-switch-report.md"
```

The example includes one stdio MCP server that can be migrated and one HTTP MCP server that is intentionally left for manual review.

## Support Matrix

| Feature | cc -> codex | codex -> cc |
| --- | --- | --- |
| Project instructions | yes | yes |
| Stdio MCP servers | yes | yes |
| HTTP/SSE MCP servers | manual review | manual review |
| Local skills | copied | copied |
| Existing duplicate MCP names | skipped | n/a |
| Account/session data | no | no |
| Remote chat history | no | no |
| User-level global settings | planned | planned |

## Current Mapping

Claude Code to Codex:

- `CLAUDE.md` -> `AGENTS.md`
- `.claude/settings.json#mcpServers` or `.mcp.json#mcpServers` -> `.codex/config.toml`
- unsupported MCP servers, such as HTTP/SSE servers without a stdio `command`, are reported for manual review
- MCP servers with names that already exist in `.codex/config.toml` are skipped to avoid duplicate TOML sections
- `.claude/skills` -> `.codex/skills`

Codex to Claude Code:

- `AGENTS.md` -> `CLAUDE.md`
- `.codex/config.toml` MCP sections -> `.mcp.json`
- Codex MCP sections without a stdio `command` are reported for manual review
- `.codex/skills` -> `.claude/skills`

## Design Notes

The project is intentionally dependency-free at the start so it can run through Node or Bun. The converter is conservative: it copies compatible config fields and writes a report for anything that needs manual verification.

## Safety Model

- `--dry-run` prints the planned file operations without writing files.
- write operations require `--yes`
- existing target files require `--force` before they can be overwritten
- every write creates `.ai-switch-backups/<timestamp>/`
- `ai-switch restore latest` restores the latest backup and removes files created by that migration
- repeated instruction migrations do not stack `ai-switch` migration headers
- account sessions, API keys outside project config, and remote history are out of scope
- MCP values are treated as configuration data and should be reviewed before running either agent

## Current Limitations

- automatic MCP conversion is limited to stdio-style servers with `command`, `args`, and `env`
- remote HTTP/SSE MCP servers are preserved as manual-review items in `ai-switch-report.md`
- Codex TOML parsing is intentionally minimal and currently expects simple single-line `args` and inline `env`
- restore refuses to delete changed migration-created files unless `--force` is used

## Roadmap

- preserve comments and unknown fields in Codex TOML instead of appending migrated MCP blocks
- support user-level config with explicit opt-in
- add package release automation for npm
- add a Homebrew tap formula after the first tagged release
- add adapters for Gemini CLI, Cursor, Windsurf, and Aider
