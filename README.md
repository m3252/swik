# ai-switch

> Move agent setup between **Claude Code** and **OpenAI Codex CLI**: instructions, MCP servers, and skills. Preview first, back up every write, restore when needed.

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** · [한국어](docs/README.ko.md) · [中文](docs/README.zh.md) · [日本語](docs/README.ja.md)

`ai-switch` is a zero-dependency CLI for switching projects between Claude Code and OpenAI Codex CLI without rebuilding the same setup by hand. It migrates only portable agent config and reports anything that needs manual attention. It never touches accounts, sessions, chat history, or secret values.

## Try It

Run once without installing:

```sh
npx @seungchan.m/ai-switch status
npx @seungchan.m/ai-switch convert cc codex --dry-run
```

Install globally:

```sh
npm install -g @seungchan.m/ai-switch
```

Then use either binary:

```sh
swik status
ai-switch status
```

`swik` is the short alias. `ai-switch` remains the full command.

## Common Workflows

### Claude Code to Codex

Preview first:

```sh
swik audit
swik convert cc codex --compile --dry-run
```

Apply after reviewing the plan:

```sh
swik convert cc codex --compile --yes
```

Use `--compile` when you want Claude's instruction hierarchy folded into `AGENTS.md`:

```text
CLAUDE.md
.claude/CLAUDE.md
.claude/rules/*.md
safe @include files
```

### Codex to Claude Code

```sh
swik convert codex cc --dry-run
swik convert codex cc --yes
```

### Undo a Migration

```sh
swik backups
swik restore latest
```

### Create a Handoff File

```sh
swik handoff --stdout
swik handoff --from codex --to cc
swik handoff
```

`handoff` creates `CODEX-HANDOFF.md` from git metadata only. It does not read raw chat, sessions, or file contents.

### Home-Level Config

Use `--global` only when you intentionally want to inspect or migrate `~/.claude` / `~/.codex` allowlisted config:

```sh
swik status --global
swik convert cc codex --global --dry-run
swik convert cc codex --global --yes
swik restore latest --global
```

## What It Moves

| Surface | Claude Code | Codex | Notes |
| --- | --- | --- | --- |
| Instructions | `CLAUDE.md` | `AGENTS.md` | `--compile` can fold Claude's hierarchy into one file |
| MCP servers | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` | stdio and HTTP URL servers; auth reviewed manually |
| Skills | `.claude/skills/` | `.agents/skills/` | copied as local skill folders |

Out of scope by design:

- accounts and login state
- remote chat history and private sessions
- API keys and literal secret values
- Claude-only surfaces with no clean Codex equivalent

## Example Output

```text
$ swik convert cc codex --compile --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   ai-switch-report.md
```

```text
$ swik audit
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

## Command Reference

| Command | Copy-paste example |
| --- | --- |
| Inspect project | `swik status` |
| Machine-readable detection | `swik detect` |
| Full Claude surface audit | `swik audit` |
| Health check | `swik doctor` |
| Preview Claude Code -> Codex | `swik convert cc codex --compile --dry-run` |
| Apply Claude Code -> Codex | `swik convert cc codex --compile --yes` |
| Preview Codex -> Claude Code | `swik convert codex cc --dry-run` |
| Apply Codex -> Claude Code | `swik convert codex cc --yes` |
| List backups | `swik backups` |
| Restore latest backup | `swik restore latest` |
| Generate handoff | `swik handoff` |
| Print handoff only | `swik handoff --stdout` |
| Global status | `swik status --global` |

Provider aliases:

```text
cc = claude = claude-code
codex = codex
```

Useful flags:

| Flag | Meaning |
| --- | --- |
| `--dry-run` | preview changes and write nothing |
| `--yes` | allow a migration to write files |
| `--force` | allow overwriting files that are otherwise protected |
| `--compile` | synthesize Claude's instruction hierarchy into `AGENTS.md` |
| `--include-local` | include `CLAUDE.local.md` during `--compile` |
| `--global` | operate on allowlisted home-level config |
| `--stdout` | print handoff content instead of writing it |

## Safety Model

Conservative by default:

- `--dry-run` prints the plan and writes nothing.
- Migration writes require `--yes`.
- Existing files are not overwritten without `--force`.
- Every migration snapshots originals to `.ai-switch-backups/<timestamp>/` (gitignored).
- `restore latest` restores originals and removes files created by the migration.
- Restore refuses to delete migration-created files you edited after migration unless you pass `--force`.

`.codex/config.toml` is the only overwrite-rule exception: migrations preserve existing content and only append new, non-conflicting MCP servers.

## Credentials and Secrets

MCP servers often need API keys or tokens. ai-switch migrates the wiring — server names, commands, args, and env-var names — but never copies secret values into the other tool's config or the report.

If the source config has a literal env value, ai-switch rewrites it as a `$NAME` reference in the target config and lists that variable in `ai-switch-report.md`.

Backups preserve original files for exact rollback. If your source config already contains literal secrets, the local backup may contain them too. Project backups live in `.ai-switch-backups/`; global backups live in `~/.ai-switch/backups/global/`. Both are gitignored.

## Compile Instructions

By default, `cc -> codex` copies only the root `CLAUDE.md`.

With `--compile`, ai-switch writes a traceable `AGENTS.md` with source labels:

```sh
swik convert cc codex --compile --dry-run
swik convert cc codex --compile --yes
swik convert cc codex --compile --include-local --yes
```

The compiled output includes sections like:

```md
# Project Instructions

Compiled from Claude Code by ai-switch (--compile).

## From CLAUDE.md
...

## From .claude/rules/style.md
...
```

Safe `@path` includes are inlined with source markers. Absolute paths, `~` paths, missing files, unsupported file types, oversized files, and circular includes are kept in place and reported.

## Handoff

`swik handoff` writes a standalone `CODEX-HANDOFF.md` scaffold for the next agent:

```sh
swik handoff
swik handoff --stdout
swik handoff --from codex --to cc
```

Auto-filled from git:

- current branch
- changed files from `git status`
- diff summary from `git diff --stat`
- recent commits from `git log --oneline`

Left blank for you:

- goal
- decisions
- open TODO
- how to test
- known risks
- notes

Only the project basename is recorded, not your absolute local path.

## Limitations

- Auto MCP conversion covers stdio (`command`/`args`/`env`) and HTTP (`url`) servers.
- Auth headers and bearer tokens are flagged for manual setup, not copied.
- Claude custom agents, commands, hooks, permissions, and output styles are reported rather than pretended to be portable.
- Raw chat history and private sessions are never migrated.
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

Issues and PRs welcome. Built from public behavior and documented file formats only. Please do not add proprietary, leaked, or reverse-engineered source. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
