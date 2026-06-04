# ai-switch

> 在 **Claude Code** 与 **Codex** 之间迁移项目配置 —— `CLAUDE.md`/`AGENTS.md`、MCP 服务器、技能。可回滚，带备份。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) · [한국어](README.ko.md) · **中文** · [日本語](README.ja.md)

一个零依赖的 CLI，帮你搬运在 Claude Code 与 Codex 之间切换时本来要手动重建的**项目级配置**。每次写入都会备份，每次运行都可用 `--dry-run` 预览，无法安全自动转换的内容会被**报告而非丢弃**。

它绝不触碰账号、会话、聊天记录或密钥值。

## 为什么需要

AI 编码工具几乎每周都在改进。今天某个任务的最佳工具，下个月未必还是最佳 —— 只因习惯而守着用惯的那个，会悄悄让你失去新工具带来的生产力。要让生产力最大化，就用*此刻*最好的工具，而不是你最先学会的那个。

让切换变痛苦的，是每次都要**手动重建你的配置** —— 指令、MCP 服务器、技能。这种摩擦才是真正的锁定。

`ai-switch` 通过让配置可移植来消除它。一条命令完成转换，跟随最好的工具而非你恰好配置过的那个：这周尝鲜，下周切回，或在不同项目里同时用两者。无法安全自动转换的内容会被报告以供人工检查，绝不静默丢弃。

## 安装

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+

# 或不安装，运行一次:
npx @seungchan.m/ai-switch status
```

## 快速开始

```sh
ai-switch status                      # 这个项目里有什么?
ai-switch convert cc codex --dry-run  # 预览 —— 不写入任何文件
ai-switch convert cc codex --yes      # 应用 —— 先备份
ai-switch restore latest              # 撤销
```

`cc` = Claude Code，`codex` = Codex。用 `convert codex cc` 反向。

```text
$ ai-switch convert cc codex --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   ai-switch-report.md
```

## 迁移内容

| 领域 | Claude Code | Codex |
| --- | --- | --- |
| 指令 | `CLAUDE.md` | `AGENTS.md` |
| MCP 服务器 | `.mcp.json`、`.claude/settings.json` | `.codex/config.toml` |
| 技能 | `.claude/skills/` | `.agents/skills/`（+ `.codex/skills/`） |

设计上不在范围内：账号、会话、远程聊天记录、API 密钥 / 密钥值。

## 命令

| 命令 | 作用 |
| --- | --- |
| `status` | 当前项目摘要（`--global` 查看 `~/.claude`、`~/.codex`） |
| `detect` | 以机器可读 JSON 列出检测到的文件 |
| `audit` | 把每个 Claude 领域分类为 migrated / manual / not-portable |
| `doctor` | 报告问题与警告 |
| `convert <from> <to>` | 迁移配置（`cc` ↔ `codex`）。标志：`--dry-run`、`--yes`、`--force`、`--compile`、`--global` |
| `handoff` | 从 git 状态生成 `CODEX-HANDOFF.md` 脚手架 —— 绝不含原始聊天 |
| `backups` | 列出带时间戳的备份 |
| `restore <latest\|timestamp>` | 恢复备份并撤销迁移 |

```text
$ ai-switch status
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

## 安全模型

默认保守：

- `--dry-run` 只打印计划，不写入任何内容。
- 迁移写入需要 `--yes`。
- 不加 `--force` **不会**覆盖已有文件。
- 每次迁移都会把原文件快照到 `.ai-switch-backups/<timestamp>/`（已 gitignore）。
- `restore latest` 撤销迁移 —— 恢复原文件、删除其创建的文件 —— 并且拒绝删除你之后改过的、由迁移创建的文件（除非 `--force`）。

`.codex/config.toml` 是覆盖规则的唯一例外：迁移会保留已有内容，只**追加**不冲突的 MCP 服务器。

## 全局配置

项目转换在仓库目录里运行。Home 级（`~/.claude`、`~/.codex`）配置有独立的显式 `--global` 标志：

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch restore latest --global
```

`--global` 是**仅白名单**：只触碰 `CLAUDE.md`/`AGENTS.md`、`settings.json#mcpServers`/`config.toml#mcp_servers` 和 `skills/`。绝不读写 `auth.json`、`sessions/`、`state_*.sqlite`、日志或缓存。设置时遵循 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`。全局备份在 `~/.ai-switch/backups/global/`。

## 支持矩阵

| 功能 | cc → codex | codex → cc |
| --- | --- | --- |
| 项目指令 | 是 | 是 |
| Stdio MCP 服务器 | 是 | 是 |
| HTTP MCP 服务器（`url`） | 是（认证手动） | 是（认证手动） |
| 本地技能 | 是（复制） | 是（复制） |
| 重复 MCP 名称 | 跳过 | — |
| 账号 / 会话数据 | 否 | 否 |
| 远程聊天记录 | 否 | 否 |
| 全局配置 | 是（`--global`） | 是（`--global`） |

### 转换映射

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 或 `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio 服务器 → `command`/`args`/`env`；HTTP（`type: http`、`url`） → Codex `url` 服务器（认证头标记为手动设置）
- `.codex/config.toml` 中已存在的 MCP 名称 → 跳过（无重复段）
- `.claude/skills` → `.agents/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` 的 MCP 段 → `.mcp.json`；stdio → `command`/`args`/`env`，`url` → `{ "type": "http", "url" }`（bearer/头部认证标记为手动设置）
- `.codex/skills` **和** `.agents/skills` → `.claude/skills`

## 凭证与密钥

MCP 服务器需要密钥（API key、token）。ai-switch 只迁移**接线** —— 服务器名、命令、参数、环境变量*名*，绝不把密钥**值**复制进另一个工具的配置或报告。源中的字面值会被**改写成 `$NAME` 引用**并列入 `ai-switch-report.md`，这样你为新工具设置同样的环境变量即可（若泄露请轮换）。

> **备份与密钥。** 备份保留你的**原始**文件，让 `restore` 精确还原。若你的*源*配置本就含字面密钥，本地备份（`.ai-switch-backups/`、`~/.ai-switch/backups/global/`；都已 gitignore）可能也会含有，报告总会提示这一点。保证：ai-switch 绝不把字面值写入*另一个工具的*配置或报告。

## `--compile`：展平指令层级

默认 `cc → codex` 只复制根 `CLAUDE.md`。但 Claude Code 加载的是*层级*：`CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@`-导入。`--compile` 把这一切合成到一个 `AGENTS.md`，每部分置于 `## From <source>` 标题下：

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # 也并入 CLAUDE.local.md
```

`@path` 行会带 `<!-- included from … -->` 标记内联。默认安全：不加 `--include-local` 则排除 `CLAUDE.local.md`；只有当导入是小于 40KB（合计 200KB）的仓库相对文本文件（`.md/.txt/.json/.yaml/.yml/.toml`）时才内联。绝对/`~` 路径、缺失文件、错误类型、循环导入会保持原样并报告 —— 绝不静默丢弃。

## `handoff`：安全的上下文脚手架

`ai-switch handoff` 为下一个 agent 生成独立的 `CODEX-HANDOFF.md`。它**绝不**读取原始聊天、会话或文件内容 —— 只取 git 派生的项目状态，外加 git 无法得知的人类上下文留白。

```sh
ai-switch handoff                       # 写入 CODEX-HANDOFF.md
ai-switch handoff --stdout              # 不写入，直接打印
ai-switch handoff --from codex --to cc  # 标注方向
```

从 git 自动填充：当前分支、变更文件（`git status`）、diff 摘要（`git diff --stat`）、近期提交（`git log --oneline`）。留白：目标、决策、待办、如何测试、已知风险、备注。`--from`/`--to` 只为脚手架加标注，不改变所收集的 git 数据。不加 `--force` 不覆盖已有文件，`AGENTS.md` 永不作为目标，且只记录项目 basename，而非你的绝对路径。

## 范围与 audit

ai-switch 迁移三个领域 —— **指令、MCP 服务器、技能**。Claude Code 还有更多（`.claude/agents`、`.claude/commands`、settings 的 `hooks`/`permissions`、output styles…），在 Codex 没有干净的一一对应。与其假装，不如让 `audit` 列出找到的一切并分类：

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

每份迁移报告也包含同样的 **“Other Claude surfaces detected”** 段落，这样转换绝不会在尚未完成时看起来已完成。

## 限制

- 自动 MCP 转换覆盖 stdio（`command`/`args`/`env`）与 HTTP（`url`）服务器；认证头/bearer token 会被标记为手动设置，不复制。
- 绝不迁移原始聊天记录与私有会话 —— 改用 `handoff` 获取安全的 git 派生脚手架。
- `--global` 仅白名单，绝不触碰 auth/session/state/log/cache 文件。

## 路线图

- [x] 凭证清单 + 多行 TOML 解析（0.2.0）
- [x] 全局 `convert --global`，仅白名单（0.3.0）
- [x] `.agents/skills` + HTTP MCP `url` 转换（0.4.0）
- [x] `audit` —— 把领域分类为 migrated / manual / not-portable（0.5.0）
- [x] `convert --compile` —— 展平 CLAUDE.md 层级（0.6.0）
- [x] `handoff` —— git 派生的上下文脚手架（0.7.0）
- [ ] Gemini CLI 与 Cursor 适配器
- [ ] 写 Codex TOML 时保留注释/未知字段
- [ ] 带显式危险警告的 opt-in `--include-env-values`

## 贡献

欢迎 Issue 与 PR。本项目**仅基于公开行为与有文档的文件格式**构建 —— 请勿加入专有、泄露或逆向工程的源码。参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
