# ai-switch

[English](README.md) · [한국어](README.ko.md) · **中文** · [日本語](README.ja.md)

> 在 **Claude Code** 与 **Codex** 之间安全、可回滚地迁移项目的智能体配置 —— 指令、MCP 服务器与技能。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

换新手机时，迁移工具会帮你转移联系人和设置。`ai-switch` 为 AI 编程工具做同样的事：在 Claude Code 与 Codex 之间切换时，它会迁移那些原本需要你手动重建的**项目级配置**。

它绝不触碰账户、会话、聊天记录或项目之外的密钥 —— 而且每次更改都会备份，可随时撤销。

---

## 为什么需要它

如果你使用不止一个 AI 编程智能体，就得反复重写相同的配置：指令文件、MCP 服务器和技能。`ai-switch` 用一条命令完成转换，并且**对于无法安全自动转换的项，会报告而不是悄悄丢弃**。

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

请在实际仓库/项目目录中运行项目转换，不要在主目录（`~`）中运行。主目录级设置目前只能只读查看：

```sh
ai-switch status --global
```

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
| 用户级全局配置 | 🔎 仅 status | 🔎 仅 status |

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

## 限制

- 自动 MCP 转换仅覆盖 stdio 服务器（`command`、`args`、`env`）；远程 HTTP/SSE 服务器会在 `ai-switch-report.md` 中列为人工复核项。
- TOML 解析有意保持精简，目前假定单行 `args` 和内联 `env`。
- 全局（主目录级）支持目前为**只读** —— 仅 `status --global`，尚无全局 `convert`。

## 路线图

- 写入 Codex TOML 时保留注释与未知字段
- 可选启用的全局（`convert --global`）支持
- npm 发布自动化
- 为 Gemini CLI、Cursor、Windsurf、Aider 提供适配器

## 贡献

欢迎 Issue 与 PR。本项目仅基于**公开行为与有文档记载的文件格式**构建 —— 请勿加入专有、泄露或逆向工程得到的源码。参见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)
