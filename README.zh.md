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
| 技能 | `.claude/skills/` | `.codex/skills/` |

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
| `doctor` | 检测问题与警告 |
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
manual-review mcp: linear (HTTP 服务器 —— 仅自动转换 stdio command/args/env)
create        .codex/config.toml
copy          .claude/skills -> .codex/skills
report        ai-switch-report.md
```

示例特意包含一个 stdio MCP 服务器（自动迁移）和一个 HTTP MCP 服务器（标记为人工复核），让你能看到两条路径。

## 安全模型

`ai-switch` 默认保守：

- 🔍 `--dry-run` 只打印计划，不写入任何内容
- ✋ 写入需要 `--yes`
- 🛡️ 没有 `--force` 时**不会**覆盖已存在的文件
- 💾 每次写入都会快照到 `.ai-switch-backups/<timestamp>/`
- ↩️ `restore latest` 撤销迁移 —— 恢复原文件并移除其创建的文件
- 🚫 若你之后修改过迁移生成的文件，restore 在没有 `--force` 时拒绝删除它

`.codex/config.toml` 是覆盖规则的唯一例外：迁移会保留已有内容，仅追加不冲突的新 MCP 服务器。

## 支持矩阵

| 功能 | cc → codex | codex → cc |
| --- | --- | --- |
| 项目指令 | ✅ | ✅ |
| Stdio MCP 服务器 | ✅ | ✅ |
| HTTP/SSE MCP 服务器 | 📝 人工复核 | 📝 人工复核 |
| 本地技能 | ✅ 复制 | ✅ 复制 |
| 重复的 MCP 名称 | ⏭️ 跳过 | — |
| 账户 / 会话数据 | ❌ | ❌ |
| 远程聊天记录 | ❌ | ❌ |
| 用户级全局配置 | ✅ `--global`（allowlist） | ✅ `--global`（allowlist） |

## 转换映射

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 或 `.mcp.json#mcpServers` → `.codex/config.toml`
- 没有 stdio `command` 的 HTTP/SSE 服务器 → 报告为人工复核
- `.codex/config.toml` 中已存在的 MCP 名称 → 跳过（避免重复的 TOML 段）
- `.claude/skills` → `.codex/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` 的 MCP 段 → `.mcp.json`
- 没有 stdio `command` 的 Codex 段 → 报告为人工复核
- `.codex/skills` → `.claude/skills`

## 凭证

MCP 服务器通常需要密钥（API key、token）。ai-switch 只迁移**接线** —— 服务器名称、command、args 以及 env 变量*名称* —— 绝不在工具之间或报告中复制密钥**值**。迁移后，`ai-switch-report.md` 会列出已迁移服务器所需的全部凭证，你只需为新工具设置相同的环境变量即可。在迁移后的配置中，任何明文值都会被**改写为 `$NAME` 引用**（值本身绝不复制到目标配置或报告中），并在报告中列出，便于你在环境中设置它，若是密钥则进行轮换。

> **备份与密钥。** 备份保留你的**原始** allowlist 文件，以便 `restore` 能精确还原。如果你的*源*配置已包含明文密钥，本地备份（项目：`.ai-switch-backups/`，全局：`~/.ai-switch/backups/global/`；均已 gitignore）也可能包含它们 —— 发生时报告与 CLI 会发出警告。我们保证的是：ai-switch 绝不把明文值写入*另一个工具*的配置或报告。

> ai-switch 迁移的是**持久的智能体指令与 MCP 接线** —— 而非原始聊天记录、私有会话或密钥值。

## 限制

- 自动 MCP 转换仅覆盖 stdio 服务器（`command`、`args`、`env`）；远程 HTTP/SSE 服务器会在 `ai-switch-report.md` 中列为人工复核项。
- **原始聊天记录和私有会话绝不迁移** —— 其中可能混有代码、密钥和个人信息，且在工具间无法通用。计划改为提供 `handoff` 摘要导出。
- 全局 `--global` convert 仅限 allowlist，绝不触碰 auth/session/state/log/cache 文件；扩展 allowlist 会刻意保持保守。

## 路线图

- ✅ 凭证清单 —— 报告每个已迁移 MCP 服务器所需的 env 变量（0.2.0）
- ✅ 多行 TOML `args`/`env` 解析（0.2.0）
- ✅ 全局 `convert --global`（仅限 allowlist）—— 主目录级配置（0.3.0）
- `handoff` —— 为下一个智能体导出简洁的项目上下文摘要（而非原始聊天）
- 为 Gemini CLI、Cursor 提供适配器
- 写入 Codex TOML 时保留注释与未知字段
- 可选的 `--include-env-values`（复制密钥值，置于明确的危险警告之后）

## 贡献

欢迎 Issue 与 PR。本项目仅基于**公开行为与有文档记载的文件格式**构建 —— 请勿加入专有、泄露或逆向工程得到的源码。参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
