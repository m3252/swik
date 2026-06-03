# ai-switch

**English** · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

> Switch your project's agent setup between **Claude Code** and **Codex** — instructions, MCP servers, and skills — safely and reversibly.

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

When you move to a new phone, a migration app carries over your contacts and settings. `ai-switch` does the same thing for AI coding tools: it moves the **project-level config** that you would otherwise re-create by hand when switching between Claude Code and Codex.

It never touches accounts, sessions, chat history, or secrets outside your project — and every change is backed up so you can undo it.

---

## Why

AI coding tools ship improvements almost every week. The best tool for a task today may not be the best one next month — and staying on whatever you're used to, out of habit, quietly costs you the productivity that newer tools unlock. The smart move is to use the best tool available *right now*, not the one you happened to learn first.

The one thing that makes switching painful is having to **rebuild your setup by hand** — instructions, MCP servers, skills — every single time. That friction is the real lock-in.

`ai-switch` removes it by making your setup portable. Convert it in one command and follow the best tool instead of the one you happened to configure: try something new this week, switch back the next, or run both across different projects. Anything it can't safely auto-convert is **reported for manual review**, never silently dropped.

## What it moves

| Type | Claude Code | Codex |
| --- | --- | --- |
| Instructions | `CLAUDE.md` | `AGENTS.md` |
| MCP servers | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` |
| Skills | `.claude/skills/` | `.codex/skills/` |

**Out of scope (by design):** accounts, sessions, remote chat history, API keys/secrets.

## Quick start

```sh
# Inspect what's in the current project
ai-switch status

# Preview a migration (no files written)
ai-switch convert cc codex --dry-run

# Apply it (creates a backup first)
ai-switch convert cc codex --yes

# Changed your mind? Roll it back
ai-switch restore latest
```

Run project conversions from a repository directory, not from your home directory (`~`). Home-level settings are read-only for now:

```sh
ai-switch status --global
```

During development, run it directly with Node or Bun:

```sh
node ./src/cli.js status
bun run src/cli.js convert cc codex --dry-run
```

Install:

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+
bunx @seungchan.m/ai-switch             # requires Bun
```

## Commands

| Command | What it does |
| --- | --- |
| `status` | Human-readable summary of the current project |
| `status --global` | Read-only summary of home-level config (`~/.claude`, `~/.codex`) |
| `detect` | Machine-readable JSON of detected files |
| `doctor` | Detect problems and warnings |
| `convert <from> <to>` | Migrate config (`cc` ↔ `codex`). Add `--dry-run`, `--yes`, `--force` |
| `backups` | List timestamped backups |
| `restore latest \| <timestamp>` | Restore a backup and undo a migration |

`status` reads like this:

```text
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

Global status follows `CLAUDE_CONFIG_DIR` / `CODEX_HOME` when set, instead of assuming `~/.claude` and `~/.codex`.

## Example

Preview the bundled example — dry runs show exactly what will happen before anything is written:

```sh
node src/cli.js convert cc codex --dry-run --cwd examples/claude-project
```

```text
create        AGENTS.md
manual-review mcp: linear (HTTP server — only stdio command/args/env are auto-converted)
create        .codex/config.toml
copy          .claude/skills -> .codex/skills
report        ai-switch-report.md
```

The example deliberately includes one stdio MCP server (auto-migrated) and one HTTP MCP server (flagged for manual review), so you can see both paths.

## Safety model

`ai-switch` is conservative by default:

- 🔍 `--dry-run` prints the plan and writes nothing
- ✋ writes require `--yes`
- 🛡️ existing files are **not** overwritten without `--force`
- 💾 every write snapshots to `.ai-switch-backups/<timestamp>/`
- ↩️ `restore latest` undoes a migration — restoring originals and removing files it created
- 🚫 restore refuses to delete migration-created files you've since edited (unless `--force`)

`.codex/config.toml` is the one exception to the overwrite rule: migrations preserve existing content and only append new, non-conflicting MCP servers.

## Support matrix

| Feature | cc → codex | codex → cc |
| --- | --- | --- |
| Project instructions | ✅ | ✅ |
| Stdio MCP servers | ✅ | ✅ |
| HTTP/SSE MCP servers | 📝 manual review | 📝 manual review |
| Local skills | ✅ copied | ✅ copied |
| Duplicate MCP names | ⏭️ skipped | — |
| Account / session data | ❌ | ❌ |
| Remote chat history | ❌ | ❌ |
| User-level global config | 🔎 status only | 🔎 status only |

## How conversion maps

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` or `.mcp.json#mcpServers` → `.codex/config.toml`
- HTTP/SSE servers without a stdio `command` → reported for manual review
- MCP names already in `.codex/config.toml` → skipped (no duplicate TOML sections)
- `.claude/skills` → `.codex/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` MCP sections → `.mcp.json`
- Codex sections without a stdio `command` → reported for manual review
- `.codex/skills` → `.claude/skills`

## Credentials

MCP servers usually need secrets (API keys, tokens). ai-switch migrates the **wiring** — server names, commands, args, and env-var *names* — but never copies secret **values** between tools or into the report. After a migration, `ai-switch-report.md` lists every credential the migrated servers need, so you can set the same environment variables for the new tool. In the migrated config, any literal value is **rewritten as a `$NAME` reference** — the value itself is never copied — and listed in the report so you can set it in your environment and rotate it if it was a secret.

> ai-switch migrates **durable agent instructions and MCP wiring** — not raw chat history, private sessions, or secret values.

## Limitations

- Automatic MCP conversion covers stdio servers (`command`, `args`, `env`); remote HTTP/SSE servers are listed in `ai-switch-report.md` for manual review.
- **Raw chat history and private sessions are never migrated** — they may contain code, secrets, and personal data, and don't translate across tools. A `handoff` summary export is planned instead.
- Global (home-level) support is **read-only** for now — `status --global` only; no global `convert` yet.

## Roadmap

- ✅ Credential inventory — report the env vars each migrated MCP server needs (0.2.0)
- ✅ Multi-line TOML `args`/`env` parsing (0.2.0)
- Memory: migrate global instruction/memory files (`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`) under explicit `--global`
- `handoff` — export a concise project-context summary for the next agent (never raw chat history)
- Opt-in global `convert --global` for home-level config
- Adapters for Gemini CLI and Cursor
- Preserve comments and unknown fields when writing Codex TOML
- Opt-in `--include-env-values` to copy secret values, behind an explicit danger warning

## Contributing

Issues and PRs welcome. This project is built from **public behavior and documented file formats only** — please do not add proprietary, leaked, or reverse-engineered source. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
