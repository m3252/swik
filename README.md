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
| Skills | `.claude/skills/` | `.agents/skills/` (+ `.codex/skills/`) |

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

Run project conversions from a repository directory, not from your home directory (`~`). Home-level (global) config has its own explicit `--global` flag:

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch backups --global
ai-switch restore latest --global
```

Global convert is **allowlist-only**: it touches just `CLAUDE.md`/`AGENTS.md`, `settings.json#mcpServers`/`config.toml#mcp_servers`, and `skills/`. It never reads or writes `auth.json`, `sessions/`, `state_*.sqlite`, logs, or caches. Global backups live in `~/.ai-switch/backups/global/`.

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
| `audit` | Classify every Claude surface as migrated / manual / not-portable |
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
create        .codex/config.toml
copy          .claude/skills -> .agents/skills
report        ai-switch-report.md
```

The example includes a stdio MCP server and an HTTP MCP server — both auto-migrated (stdio → `command`, HTTP → `url`). Because one env value is a literal, the CLI also prints a warning that the local backup will preserve it.

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
| HTTP MCP servers (`url`) | ✅ url (auth manual) | ✅ url (auth manual) |
| Local skills | ✅ copied | ✅ copied |
| Duplicate MCP names | ⏭️ skipped | — |
| Account / session data | ❌ | ❌ |
| Remote chat history | ❌ | ❌ |
| User-level global config | ✅ `--global` (allowlist) | ✅ `--global` (allowlist) |

## How conversion maps

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` or `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio servers → `command`/`args`/`env`; HTTP servers (`type: http`, `url`) → a Codex `url` server (auth headers flagged for manual setup)
- MCP names already in `.codex/config.toml` → skipped (no duplicate TOML sections)
- `.claude/skills` → `.agents/skills` (Codex's current skill location)

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` MCP sections → `.mcp.json`; stdio → `command`/`args`/`env`, `url` servers → `{ "type": "http", "url" }` (bearer/header auth flagged for manual setup)
- `.codex/skills` **and** `.agents/skills` → `.claude/skills`

## Credentials

MCP servers usually need secrets (API keys, tokens). ai-switch migrates the **wiring** — server names, commands, args, and env-var *names* — but never copies secret **values** between tools or into the report. After a migration, `ai-switch-report.md` lists every credential the migrated servers need, so you can set the same environment variables for the new tool. In the migrated config, any literal value is **rewritten as a `$NAME` reference** — the value itself is never copied into the target config or report — and listed there so you can set it in your environment and rotate it if it was a secret.

> **Backups vs. secrets.** Backups preserve your **original** allowlisted files so `restore` can revert exactly. If your *source* config already contains literal secrets, the local backup (project: `.ai-switch-backups/`, global: `~/.ai-switch/backups/global/`; both gitignored) may contain them too. The report always notes this, and the CLI additionally warns when literal **env values** are present (HTTP auth headers are flagged separately for manual setup). The guarantee is that ai-switch never writes a literal value into the *other tool's* config or the report.

> ai-switch migrates **durable agent instructions and MCP wiring** — not raw chat history, private sessions, or secret values.

## Compiling the instruction hierarchy (`--compile`)

By default `cc → codex` copies only the root `CLAUDE.md`. Claude Code, though, loads a *hierarchy*: `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@`-imports. Pass `--compile` to synthesize all of it into one `AGENTS.md`, each part under a `## From <source>` header so it stays traceable:

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # also fold in CLAUDE.local.md
```

- `@path` lines are inlined with `<!-- included from … -->` markers.
- **Safe by default:** `CLAUDE.local.md` is excluded unless you pass `--include-local`; an include is only inlined if it's a repo-relative text file (`.md/.txt/.json/.yaml/.yml/.toml`) under 40KB (200KB total). Absolute/`~` paths, missing files, wrong types, and circular includes are **left in place and reported for manual review** — never silently dropped.
- Default convert (without `--compile`) is unchanged.

## Scope & audit

ai-switch migrates three surfaces — **instructions, MCP servers, and skills**. Claude Code has more (`.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules`, `.claude/agents`, `.claude/commands`, settings `hooks`/`permissions`/…), and those don't have clean one-to-one Codex equivalents. Rather than pretend, `ai-switch audit` lists everything it finds and classifies it:

```text
Migrated automatically:
  ✓ CLAUDE.md — root instructions → AGENTS.md
  ✓ MCP servers — 2 server(s) (stdio/http) → .codex/config.toml
  ✓ .claude/skills — → .agents/skills
Needs manual migration:
  ! .claude/agents — 1 custom agent(s) use tools/model/hooks; rebuild in Codex manually
  ! .claude/settings.json — non-MCP keys not migrated: hooks, permissions
Not portable:
  ✗ .claude/output-styles — no Codex equivalent
```

Every migration report also includes an **"Other Claude surfaces detected"** section with the non-migrated gaps, so a conversion never silently looks complete when it isn't.

## Limitations

- Automatic MCP conversion covers stdio servers (`command`, `args`, `env`) and HTTP servers (`url`); auth headers/bearer tokens on HTTP servers are flagged in `ai-switch-report.md` for manual setup, not copied.
- **Raw chat history and private sessions are never migrated** — they may contain code, secrets, and personal data, and don't translate across tools. A `handoff` summary export is planned instead.
- Global `--global` convert is allowlist-only and never touches auth/session/state/log/cache files; broadening the allowlist is intentionally conservative.

## Roadmap

- ✅ Credential inventory — report the env vars each migrated MCP server needs (0.2.0)
- ✅ Multi-line TOML `args`/`env` parsing (0.2.0)
- ✅ Global `convert --global` (allowlist-only) for home-level config (0.3.0)
- ✅ `.agents/skills` coverage + HTTP MCP `url` conversion (0.4.0)
- ✅ `audit` — classify Claude surfaces as migrated / manual / not-portable (0.5.0)
- ✅ `convert --compile` — synthesize the CLAUDE.md hierarchy (`.claude/rules`, `@`-includes) into AGENTS.md (0.6.0)
- `handoff` — export a concise project-context summary for the next agent (never raw chat history)
- Adapters for Gemini CLI and Cursor
- Preserve comments and unknown fields when writing Codex TOML
- Opt-in `--include-env-values` to copy secret values, behind an explicit danger warning

## Contributing

Issues and PRs welcome. This project is built from **public behavior and documented file formats only** — please do not add proprietary, leaked, or reverse-engineered source. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
