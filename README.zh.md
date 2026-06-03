# ai-switch

[English](README.md) · [한국어](README.ko.md) · **中文** · [日本語](README.ja.md)

> 在 **Claude Code** 与 **Codex** 之间安全、可回滚地迁移项目的智能体配置 —— 指令、MCP 服务器与技能。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

换新手机时，迁移工具会帮你转移联系人和设置。`ai-switch` 为 AI 编程工具做同样的事：在 Claude Code 与 Codex 之间切换时，它会迁移那些原本需要你手动重建的**项目级配置**。

它绝不触碰账户、会话、聊天记录或项目之外的密钥 —— 而且每次更改都会备份，可随时撤销。

---

## 为什么需要它

AI 编程工具几乎每周都在快速迭代。今天最好的工具，下个月未必依然最好；仅仅因为用得顺手就固守一个工具，意味着每次都白白错过新工具带来的生产力提升。明智的做法，是用*此刻最好的工具*，而不是你最先学会的那个。

让人迟迟不愿切换的唯一原因，是每次都要**手动重建你的配置** —— 指令、MCP 服务器、技能，逐一重来。正是这种摩擦把你悄悄锁死在一个工具上。

`ai-switch` 通过让配置变得可携带来消除这种摩擦。用一条命令完成转换，从此跟随最好的工具，而不是你碰巧配置好的那个：这周试试新工具，下周再切回来，或在不同项目里同时用两个。无法安全自动转换的项会**报告为人工复核**，绝不悄悄丢弃。

## 它迁移什么

| 类型 | Claude Code | Codex |
| --- | --- | --- |
| 指令 | `CLAUDE.md` | `AGENTS.md` |
| MCP 服务器 | `.mcp.json`、`.claude/settings.json` | `.codex/config.toml` |
| 技能 | `.claude/skills/` | `.agents/skills/`（+ `.codex/skills/`） |

**不在范围内（有意为之）：** 账户、会话、远程聊天记录、API 密钥/机密。

## 快速开始

```sh
# 查看当前项目中有什么
ai-switch status

# 预览迁移（不写入文件）
ai-switch convert cc codex --dry-run

# 应用迁移（会先创建备份）
ai-switch convert cc codex --yes

# 改主意了？回滚
ai-switch restore latest
```

请在实际仓库/项目目录中运行项目转换，不要在主目录（`~`）中运行。主目录级（全局）配置有独立的 `--global` 标志：

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch backups --global
ai-switch restore latest --global
```

全局 convert 是**仅限 allowlist** 的：只处理 `CLAUDE.md`/`AGENTS.md`、`settings.json#mcpServers`/`config.toml#mcp_servers` 和 `skills/`。它绝不读取或写入 `auth.json`、`sessions/`、`state_*.sqlite`、日志或缓存。全局备份位于 `~/.ai-switch/backups/global/`。

开发期间可用 Node 或 Bun 直接运行：

```sh
node ./src/cli.js status
bun run src/cli.js convert cc codex --dry-run
```

安装：

```sh
npm install -g @seungchan.m/ai-switch   # 需要 Node 20+
bunx @seungchan.m/ai-switch             # 需要 Bun
```

## 命令

| 命令 | 作用 |
| --- | --- |
| `status` | 当前项目的可读摘要 |
| `status --global` | 主目录级配置（`~/.claude`、`~/.codex`）的只读摘要 |
| `detect` | 已检测文件的机器可读 JSON |
| `audit` | 将每个 Claude 表面分类为 自动迁移/手动/不可移植 |
| `doctor` | 检测问题与警告 |
| `handoff` | 从 git 状态创建 `CODEX-HANDOFF.md` 脚手架，不读取原始聊天 |
| `convert <from> <to>` | 迁移配置（`cc` ↔ `codex`），可加 `--dry-run`、`--yes`、`--force` |
| `backups` | 列出带时间戳的备份 |
| `restore latest \| <timestamp>` | 恢复备份并撤销迁移 |

`status` 的输出示例：

```text
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

当设置了 `CLAUDE_CONFIG_DIR` / `CODEX_HOME` 时，全局 status 会遵循这些位置，而非假定 `~/.claude` 和 `~/.codex`。

## 示例

用内置示例预览 —— dry run 会在写入任何文件前精确展示将要发生的操作：

```sh
node src/cli.js convert cc codex --dry-run --cwd examples/claude-project
```

```text
create        AGENTS.md
create        .codex/config.toml
copy          .claude/skills -> .agents/skills
report        ai-switch-report.md
```

示例包含一个 stdio MCP 服务器和一个 HTTP MCP 服务器 —— 两者都会自动迁移（stdio → `command`，HTTP → `url`）。由于其中一个 env 值是明文，CLI 还会打印一条警告，提示本地备份会保留它。

## 安全模型

`ai-switch` 默认保守：

- 🔍 `--dry-run` 只打印计划，不写入任何内容
- ✋ 迁移写入需要 `--yes`
- 🛡️ 没有 `--force` 时**不会**覆盖已存在的文件
- 📝 `handoff` 只写入 `CODEX-HANDOFF.md`（或 `--output`），没有 `--force` 不会覆盖
- 💾 迁移写入会快照到 `.ai-switch-backups/<timestamp>/`
- ↩️ `restore latest` 撤销迁移 —— 恢复原文件并移除其创建的文件
- 🚫 若你之后修改过迁移生成的文件，restore 在没有 `--force` 时拒绝删除它

`.codex/config.toml` 是覆盖规则的唯一例外：迁移会保留已有内容，仅追加不冲突的新 MCP 服务器。

## 支持矩阵

| 功能 | cc → codex | codex → cc |
| --- | --- | --- |
| 项目指令 | ✅ | ✅ |
| Stdio MCP 服务器 | ✅ | ✅ |
| HTTP MCP 服务器（`url`） | ✅ url（auth 手动） | ✅ url（auth 手动） |
| 本地技能 | ✅ 复制 | ✅ 复制 |
| 重复的 MCP 名称 | ⏭️ 跳过 | — |
| 账户 / 会话数据 | ❌ | ❌ |
| 远程聊天记录 | ❌ | ❌ |
| 用户级全局配置 | ✅ `--global`（allowlist） | ✅ `--global`（allowlist） |

## 转换映射

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 或 `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio 服务器 → `command`/`args`/`env`；HTTP 服务器（`type: http`、`url`）→ Codex `url` 服务器（auth 头标记为手动设置）
- `.codex/config.toml` 中已存在的 MCP 名称 → 跳过（避免重复的 TOML 段）
- `.claude/skills` → `.agents/skills`（Codex 当前的技能位置）

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` 的 MCP 段 → `.mcp.json`
- stdio → `command`/`args`/`env`，`url` 服务器 → `{ "type": "http", "url" }`（bearer/头部 auth 标记为手动设置）
- `.codex/skills` **和** `.agents/skills` → `.claude/skills`

## 凭证

MCP 服务器通常需要密钥（API key、token）。ai-switch 只迁移**接线** —— 服务器名称、command、args 以及 env 变量*名称* —— 绝不在工具之间或报告中复制密钥**值**。迁移后，`ai-switch-report.md` 会列出已迁移服务器所需的全部凭证，你只需为新工具设置相同的环境变量即可。在迁移后的配置中，任何明文值都会被**改写为 `$NAME` 引用**（值本身绝不复制到目标配置或报告中），并在报告中列出，便于你在环境中设置它，若是密钥则进行轮换。

> **备份与密钥。** 备份保留你的**原始** allowlist 文件，以便 `restore` 能精确还原。如果你的*源*配置已包含明文密钥，本地备份（项目：`.ai-switch-backups/`，全局：`~/.ai-switch/backups/global/`；均已 gitignore）也可能包含它们。报告始终会提示这一点，CLI 还会在存在明文 **env 值**时发出警告（HTTP auth 头会另作手动设置标记）。我们保证的是：ai-switch 绝不把明文值写入*另一个工具*的配置或报告。

> ai-switch 迁移的是**持久的智能体指令与 MCP 接线** —— 而非原始聊天记录、私有会话或密钥值。

## 编译指令层级（`--compile`）

默认的 `cc → codex` 转换只复制根目录的 `CLAUDE.md`。但 Claude Code 实际会加载一个层级：`CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@` include。使用 `--compile` 可将它们合成为一个 `AGENTS.md`，并把每段放在 `## From <source>` 标题下，便于追踪来源：

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # 同时合入 CLAUDE.local.md
```

- `@path` 行会以内联方式展开，并带有 `<!-- included from … -->` 标记。
- **默认安全：** `CLAUDE.local.md` 只有在传入 `--include-local` 时才会包含。include 仅在它是项目内文本文件（`.md/.txt/.json/.yaml/.yml/.toml`）、单文件不超过 40KB、总量不超过 200KB 时内联。绝对路径/`~` 路径、缺失文件、错误类型和循环 include 会**保留原行并写入手动审查报告**。
- 不使用 `--compile` 时，默认转换行为不变。

## handoff 脚手架（`handoff`）

`ai-switch handoff` 会为下一个智能体创建独立的 `CODEX-HANDOFF.md`。它**不读取**原始聊天记录、会话或文件内容，只从 git 推导安全的项目状态，并把 git 无法知道的人工上下文留成结构化空白：

```sh
ai-switch handoff
ai-switch handoff --stdout
ai-switch handoff --from codex --to cc
ai-switch handoff --output docs/CODEX-HANDOFF.md
ai-switch handoff --force
```

可选的 `--from`/`--to` 标志（`cc` 或 `codex`）只用于标注 handoff 方向，不会改变收集的 git 数据。

git 可自动填充：

- 当前分支
- 来自 `git status` 的变更文件
- 来自 `git diff --stat` 的 diff 摘要
- 来自 `git log --oneline` 的最近提交

保留为空白：

- 目标
- 已做决定
- 待办事项
- 测试方法
- 已知风险
- 给下一个智能体的备注

默认输出为项目根目录的 `CODEX-HANDOFF.md`。已有文件不会被覆盖，除非传入 `--force`，且 `AGENTS.md` 永远不会作为 handoff 目标。默认情况下，handoff 只记录项目 basename，不记录你的绝对本地路径。

## 范围 & audit

ai-switch 迁移三类表面 —— **指令、MCP 服务器、技能**。Claude Code 还有更多（`.claude/CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules`、`.claude/agents`、`.claude/commands`，以及 settings 的 `hooks`/`permissions`/…），它们与 Codex 没有干净的一对一对应。与其假装，`ai-switch audit` 会列出它发现的一切并分类：

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

每份迁移报告也包含 **"Other Claude surfaces detected"** 段（未迁移的缺口），使转换不会在尚未完成时看起来已完成。`doctor` 在存在缺口时会引导你使用 `audit`。

## 限制

- 自动 MCP 转换覆盖 stdio 服务器（`command`、`args`、`env`）和 HTTP 服务器（`url`）；HTTP 服务器的 auth 头/bearer token 不会被复制，而是在 `ai-switch-report.md` 中列为手动设置项。
- **原始聊天记录和私有会话绝不迁移** —— 其中可能混有代码、密钥和个人信息，且在工具间无法通用。可改用 `ai-switch handoff` 生成安全的 git 派生脚手架。
- 全局 `--global` convert 仅限 allowlist，绝不触碰 auth/session/state/log/cache 文件；扩展 allowlist 会刻意保持保守。

## 路线图

- ✅ 凭证清单 —— 报告每个已迁移 MCP 服务器所需的 env 变量（0.2.0）
- ✅ 多行 TOML `args`/`env` 解析（0.2.0）
- ✅ 全局 `convert --global`（仅限 allowlist）—— 主目录级配置（0.3.0）
- ✅ `.agents/skills` 覆盖 + HTTP MCP `url` 转换（0.4.0）
- ✅ `audit` —— 将 Claude 表面分类为自动/手动/不可移植（0.5.0）
- ✅ `convert --compile` —— 将 CLAUDE.md 层级（`.claude/rules`、`@` include）合成为 AGENTS.md（0.6.0）
- ✅ `handoff` —— 为下一个智能体导出简洁的项目上下文脚手架（而非原始聊天）（0.7.0）
- 为 Gemini CLI、Cursor 提供适配器
- 写入 Codex TOML 时保留注释与未知字段
- 可选的 `--include-env-values`（复制密钥值，置于明确的危险警告之后）

## 贡献

欢迎 Issue 与 PR。本项目仅基于**公开行为与有文档记载的文件格式**构建 —— 请勿加入专有、泄露或逆向工程得到的源码。参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
