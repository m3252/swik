# ai-switch

> 在 **Claude Code** 与 **Codex** 之间移动项目配置：指令、MCP 服务器和技能。先预览，每次写入都备份，需要时可恢复。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

[English](../README.md) · [한국어](README.ko.md) · **中文** · [日本語](README.ja.md)

`ai-switch` 是一个零依赖 CLI，用来在 Claude Code 与 Codex 之间切换项目，而不用每次手动重建同一套配置。日常使用的命令是 **`swik`**；npm 包使用作用域名 `@seungchan.m/ai-switch` 以避免名称冲突。它只迁移可移植的项目配置，并报告需要人工处理的内容。它绝不触碰账号、会话、聊天记录或密钥值。

## 立即试用

无需安装，直接运行一次：

```sh
npx @seungchan.m/ai-switch status
npx @seungchan.m/ai-switch convert cc codex --dry-run
```

全局安装：

```sh
npm install -g @seungchan.m/ai-switch
```

安装后使用 `swik`：

```sh
swik status
swik sync --compile --dry-run
```

完整命令 `ai-switch` 仍然可用，但文档示例优先使用 `swik`，以减少与非作用域 npm 包的混淆。

## 常用流程

安全同步两边工具：

```sh
swik sync --compile --dry-run
swik sync --compile --yes
```

### Claude Code 到 Codex

先预览：

```sh
swik audit
swik convert cc codex --compile --dry-run
```

确认计划后应用：

```sh
swik convert cc codex --compile --yes
```

当你想把 Claude 的指令层级折叠进 `AGENTS.md` 时使用 `--compile`：

```text
CLAUDE.md
.claude/CLAUDE.md
.claude/rules/*.md
安全的 @include 文件
```

### Codex 到 Claude Code

```sh
swik convert codex cc --dry-run
swik convert codex cc --yes
```

### 撤销迁移

```sh
swik backups
swik restore latest
```

### 创建 Handoff 文件

```sh
swik handoff --stdout
swik handoff --from codex --to cc
swik handoff
```

`handoff` 只从 git 元数据创建 `CODEX-HANDOFF.md`。它不会读取原始聊天、会话或文件内容。

### Home 级配置

只有在你明确要检查或迁移 `~/.claude` / `~/.codex` 的白名单配置时才使用 `--global`：

```sh
swik status --global
swik convert cc codex --global --dry-run
swik convert cc codex --global --yes
swik restore latest --global
```

## 迁移内容

| 领域 | Claude Code | Codex | 说明 |
| --- | --- | --- | --- |
| 指令 | `CLAUDE.md` | `AGENTS.md` | `--compile` 可把 Claude 指令层级合成一个文件 |
| MCP 服务器 | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` | stdio 与 HTTP URL 服务器；认证需人工确认 |
| 技能 | `.claude/skills/` | `.agents/skills/` | 复制为本地技能目录 |

## 兼容性基线

ai-switch 0.8.x 的测试 fixture 以 2026-06 的 Claude Code 2.1.162 与 Codex CLI 0.136.0 项目配置形状为基准。自动转换只覆盖上表中的可移植子集；其他字段会进入报告或保留为手动处理。

设计上不迁移：

- 账号和登录状态
- 远程聊天记录和私有会话
- API key 和字面量密钥值
- 没有干净 Codex 对应物的 Claude 专有领域

## 输出示例

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

## 命令参考

| 命令 | 可复制示例 |
| --- | --- |
| 查看项目 | `swik status` |
| 机器可读检测 | `swik detect` |
| 完整 Claude 领域审计 | `swik audit` |
| 健康检查 | `swik doctor` |
| 安全同步两边工具 | `swik sync --compile --dry-run` |
| 预览 Claude Code -> Codex | `swik convert cc codex --compile --dry-run` |
| 应用 Claude Code -> Codex | `swik convert cc codex --compile --yes` |
| 预览 Codex -> Claude Code | `swik convert codex cc --dry-run` |
| 应用 Codex -> Claude Code | `swik convert codex cc --yes` |
| 列出备份 | `swik backups` |
| 恢复最新备份 | `swik restore latest` |
| 生成 handoff | `swik handoff` |
| 只打印 handoff | `swik handoff --stdout` |
| 全局状态 | `swik status --global` |

Provider 别名：

```text
cc = claude = claude-code
codex = codex
```

常用标志：

| 标志 | 含义 |
| --- | --- |
| `--dry-run` | 预览变更，不写文件 |
| `--yes` | 允许迁移写入文件 |
| `--force` | 允许覆盖受保护文件 |
| `--compile` | 把 Claude 指令层级合成到 `AGENTS.md` |
| `--include-local` | 在 `--compile` 时包含 `CLAUDE.local.md` |
| `--global` | 操作白名单内的 Home 级配置 |
| `--stdout` | 打印 handoff 内容而不是写入文件 |

## 安全模型

默认保守：

- `--dry-run` 只打印计划，不写入。
- 迁移写入需要 `--yes`。
- 不加 `--force` 不覆盖已有文件。
- 每次迁移都会把原文件快照到 `.ai-switch-backups/<timestamp>/`。
- 在 Git worktree 内写入项目文件前，会把 `.ai-switch-backups/` 和 `ai-switch-report.md` 加到 `.git/info/exclude`。
- `restore latest` 会恢复原文件并删除迁移创建的文件。
- 如果迁移创建的文件之后被你修改过，restore 会拒绝删除，除非传入 `--force`。

`.codex/config.toml` 是覆盖规则的唯一例外：迁移会保留已有内容，只追加不冲突的 MCP 服务器。

## 凭证与密钥

MCP 服务器常需要 API key 或 token。ai-switch 只迁移接线：服务器名、命令、参数和环境变量名；绝不把密钥值复制到另一个工具的配置或报告中。

如果源配置里有字面量 env 值，ai-switch 会在目标配置中把它改写为 `$NAME` 引用，并在 `ai-switch-report.md` 中列出变量名。

备份会保留原始文件以便精确回滚。如果源配置本身已经包含字面量密钥，本地备份也可能包含它们。项目备份位于 `.ai-switch-backups/`；在 Git 仓库中写入前会把该目录和 `ai-switch-report.md` 加到 `.git/info/exclude`。全局备份位于项目外的 `~/.ai-switch/backups/global/`。

## Compile Instructions

默认情况下，`cc -> codex` 只复制根 `CLAUDE.md`。

使用 `--compile` 时，ai-switch 会写出带来源标签的 `AGENTS.md`：

```sh
swik convert cc codex --compile --dry-run
swik convert cc codex --compile --yes
swik convert cc codex --compile --include-local --yes
```

合成输出示例：

```md
# Project Instructions

Compiled from Claude Code by ai-switch (--compile).

## From CLAUDE.md
...

## From .claude/rules/style.md
...
```

安全的 `@path` include 会带来源标记内联。绝对路径、`~` 路径、缺失文件、不支持的文件类型、超大文件和循环 include 会保留原样并写入报告。

## Handoff

`swik handoff` 会为下一个 agent 写出独立的 `CODEX-HANDOFF.md` 脚手架：

```sh
swik handoff
swik handoff --stdout
swik handoff --from codex --to cc
```

从 git 自动填充：

- 当前分支
- `git status` 中的变更文件
- `git diff --stat` 的 diff 摘要
- `git log --oneline` 的近期提交

留给你填写：

- 目标
- 决策
- 未完成 TODO
- 如何测试
- 已知风险
- 备注

只记录项目 basename，不记录你的本地绝对路径。

## 限制

- 自动 MCP 转换覆盖 stdio（`command`/`args`/`env`）与 HTTP（`url`）服务器。
- 认证 header 和 bearer token 会被标记为手动设置，不复制。
- Claude custom agents、commands、hooks、permissions、output styles 会被报告，而不是假装可移植。
- 原始聊天记录和私有会话从不迁移。
- `--global` 仅限白名单，绝不触碰 auth/session/state/log/cache 文件。
- Codex TOML 写入目前偏 append-only。当前零依赖解析器只覆盖支持的 MCP 子集；要保留注释/未知字段，应先切换到 AST-backed TOML parser/writer。

## 路线图

- [x] 凭证清单 + 多行 TOML 解析（0.2.0）
- [x] 全局 `convert --global`，仅白名单（0.3.0）
- [x] `.agents/skills` + HTTP MCP `url` 转换（0.4.0）
- [x] `audit` — 把领域分类为 migrated / manual / not-portable（0.5.0）
- [x] `convert --compile` — 展平 CLAUDE.md 层级（0.6.0）
- [x] `handoff` — git 派生的上下文脚手架（0.7.0）
- [x] `sync` — 安全的双向项目配置 reconcile（0.8.0）
- [x] 为备份和报告加入项目本地 `.git/info/exclude` 保护（0.8.2）
- [ ] Gemini CLI 与 Cursor 适配器
- [ ] 在保留 Codex TOML 注释/未知字段前引入 AST-backed parser/writer
- [ ] 带显式危险警告的 opt-in `--include-env-values`

## 贡献

欢迎 Issue 与 PR。本项目仅基于公开行为与有文档的文件格式构建。请勿加入专有、泄露或逆向工程的源码。参见 [CONTRIBUTING.md](../CONTRIBUTING.md) 与 [SECURITY.md](../SECURITY.md)。

## 许可证

[MIT](../LICENSE)
