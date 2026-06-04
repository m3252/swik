# ai-switch

> Migrate project config between **Claude Code** and **Codex** — `CLAUDE.md`/`AGENTS.md`, MCP servers, and skills. Reversible, with backups.

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** · [한국어](README.ko.md) · [中文](README.zh.md) · [日本語](README.ja.md)

A zero-dependency CLI that moves the **project-level setup** you'd otherwise rebuild by hand when switching between Claude Code and Codex. Every write is backed up, every run previews with `--dry-run`, and anything it can't safely auto-convert is **reported, not dropped**.

It never touches accounts, sessions, chat history, or secret values.

## Why

AI coding tools ship improvements almost every week. The best tool for a task today may not be the best one next month — and staying on whatever you're used to, out of habit, quietly costs you the productivity newer tools unlock. To maximize your productivity, use the best tool available *right now*, not the one you happened to learn first.

What makes switching painful is having to **rebuild your setup by hand** — instructions, MCP servers, skills — every single time. That friction is the real lock-in.

`ai-switch` removes it by making your setup portable. Convert it in one command and follow the best tool instead of the one you happened to configure: try something new this week, switch back the next, or run both across different projects. Anything it can't safely auto-convert is reported for manual review, never silently dropped.

## Install

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+

# or run once, without installing:
npx @seungchan.m/ai-switch status
```

## Quick start

```sh
ai-switch status                      # what's in this project?
ai-switch convert cc codex --dry-run  # preview — writes nothing
ai-switch convert cc codex --yes      # apply — backs up first
ai-switch restore latest              # undo
```

`cc` = Claude Code, `codex` = Codex. Reverse it with `convert codex cc`.

```text
$ ai-switch convert cc codex --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   ai-switch-report.md
```

## What it moves

| Surface | Claude Code | Codex |
| --- | --- | --- |
| Instructions | `CLAUDE.md` | `AGENTS.md` |
| MCP servers | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` |
| Skills | `.claude/skills/` | `.agents/skills/` (+ `.codex/skills/`) |

Out of scope by design: accounts, sessions, remote chat history, API keys / secret values.

## Commands

| Command | What it does |
| --- | --- |
| `status` | Summary of the current project (add `--global` for `~/.claude`, `~/.codex`) |
| `detect` | Machine-readable JSON of detected files |
| `audit` | Classify every Claude surface as migrated / manual / not-portable |
| `doctor` | Report problems and warnings |
| `convert <from> <to>` | Migrate config (`cc` ↔ `codex`). Flags: `--dry-run`, `--yes`, `--force`, `--compile`, `--global` |
| `handoff` | Write a `CODEX-HANDOFF.md` scaffold from git state — never raw chat |
| `backups` | List timestamped backups |
| `restore <latest\|timestamp>` | Restore a backup and undo a migration |

```text
$ ai-switch status
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

## Safety model

Conservative by default:

- `--dry-run` prints the plan and writes nothing.
- Migration writes require `--yes`.
- Existing files are **not** overwritten without `--force`.
- Every migration snapshots originals to `.ai-switch-backups/<timestamp>/` (gitignored).
- `restore latest` reverts a migration — restoring originals, removing files it created — and refuses to delete migration-created files you've since edited (unless `--force`).

`.codex/config.toml` is the one exception to the overwrite rule: migrations preserve existing content and only **append** new, non-conflicting MCP servers.

## Global config

Project conversions run from a repo directory. Home-level (`~/.claude`, `~/.codex`) config has its own explicit `--global` flag:

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch restore latest --global
```

`--global` is **allowlist-only**: it touches just `CLAUDE.md`/`AGENTS.md`, `settings.json#mcpServers`/`config.toml#mcp_servers`, and `skills/`. It never reads or writes `auth.json`, `sessions/`, `state_*.sqlite`, logs, or caches. It follows `CLAUDE_CONFIG_DIR` / `CODEX_HOME` when set. Global backups live in `~/.ai-switch/backups/global/`.

## Support matrix

| Feature | cc → codex | codex → cc |
| --- | --- | --- |
| Project instructions | Yes | Yes |
| Stdio MCP servers | Yes | Yes |
| HTTP MCP servers (`url`) | Yes (auth manual) | Yes (auth manual) |
| Local skills | Yes (copied) | Yes (copied) |
| Duplicate MCP names | skipped | — |
| Account / session data | No | No |
| Remote chat history | No | No |
| Global config | Yes (`--global`) | Yes (`--global`) |

### How conversion maps

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` or `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio servers → `command`/`args`/`env`; HTTP (`type: http`, `url`) → a Codex `url` server (auth headers flagged for manual setup)
- MCP names already in `.codex/config.toml` → skipped (no duplicate sections)
- `.claude/skills` → `.agents/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` MCP sections → `.mcp.json`; stdio → `command`/`args`/`env`, `url` → `{ "type": "http", "url" }` (bearer/header auth flagged for manual setup)
- `.codex/skills` **and** `.agents/skills` → `.claude/skills`

## Credentials & secrets

MCP servers need secrets (API keys, tokens). ai-switch migrates the **wiring** — server names, commands, args, and env-var *names* — but never copies secret **values** into the other tool's config or the report. Any literal value in the source is **rewritten as a `$NAME` reference** and listed in `ai-switch-report.md`, so you set the same env vars for the new tool (and rotate them if they leaked).

> **Backups vs. secrets.** Backups preserve your **original** files so `restore` reverts exactly. If your *source* config already contains literal secrets, the local backup (`.ai-switch-backups/`, `~/.ai-switch/backups/global/`; both gitignored) may contain them too. The report always notes this. The guarantee: ai-switch never writes a literal value into the *other tool's* config or the report.

## `--compile`: flatten the instruction hierarchy

By default `cc → codex` copies only the root `CLAUDE.md`. But Claude Code loads a *hierarchy*: `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@`-imports. `--compile` synthesizes all of it into one `AGENTS.md`, each part under a `## From <source>` header:

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # also fold in CLAUDE.local.md
```

`@path` lines are inlined with `<!-- included from … -->` markers. Safe by default: `CLAUDE.local.md` is excluded unless `--include-local`; an include is only inlined if it's a repo-relative text file (`.md/.txt/.json/.yaml/.yml/.toml`) under 40KB (200KB total). Absolute/`~` paths, missing files, wrong types, and circular includes are left in place and reported — never silently dropped.

## `handoff`: a safe context scaffold

`ai-switch handoff` writes a standalone `CODEX-HANDOFF.md` for the next agent. It **never** reads raw chat, sessions, or file contents — only git-derived project state, plus structured blanks for the human context git can't know.

```sh
ai-switch handoff                       # write CODEX-HANDOFF.md
ai-switch handoff --stdout              # print instead of writing
ai-switch handoff --from codex --to cc  # label the direction
```

Auto-filled from git: current branch, changed files (`git status`), diff summary (`git diff --stat`), recent commits (`git log --oneline`). Left blank: goal, decisions, open TODO, how to test, known risks, notes. `--from`/`--to` only label the scaffold; they never change what git data is collected. Existing files aren't overwritten without `--force`, `AGENTS.md` is never a target, and only the project basename is recorded — not your absolute path.

## Scope & audit

ai-switch migrates three surfaces — **instructions, MCP servers, skills**. Claude Code has more (`.claude/agents`, `.claude/commands`, settings `hooks`/`permissions`, output styles…) with no clean one-to-one Codex equivalent. Rather than pretend, `audit` lists everything it finds and classifies it:

```text
$ ai-switch audit
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

Every migration report includes the same **"Other Claude surfaces detected"** section, so a conversion never silently looks complete when it isn't.

## Limitations

- Auto MCP conversion covers stdio (`command`/`args`/`env`) and HTTP (`url`) servers; auth headers/bearer tokens are flagged for manual setup, not copied.
- Raw chat history and private sessions are never migrated — use `handoff` for a safe git-derived scaffold instead.
- `--global` is allowlist-only and never touches auth/session/state/log/cache files.

## Roadmap

- [x] Credential inventory + multi-line TOML parsing (0.2.0)
- [x] Global `convert --global`, allowlist-only (0.3.0)
- [x] `.agents/skills` + HTTP MCP `url` conversion (0.4.0)
- [x] `audit` — classify surfaces migrated / manual / not-portable (0.5.0)
- [x] `convert --compile` — flatten the CLAUDE.md hierarchy (0.6.0)
- [x] `handoff` — git-derived context scaffold (0.7.0)
- [ ] Adapters for Gemini CLI and Cursor
- [ ] Preserve comments / unknown fields when writing Codex TOML
- [ ] Opt-in `--include-env-values` behind an explicit danger warning

## Contributing

Issues and PRs welcome. Built from **public behavior and documented file formats only** — please don't add proprietary, leaked, or reverse-engineered source. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
