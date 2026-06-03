# ai-switch

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · **日本語**

> **Claude Code** と **Codex** の間で、プロジェクトのエージェント設定 —— 指示・MCP サーバー・スキル —— を安全かつ元に戻せる形で移行します。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

新しいスマホに替えるとき、移行アプリが連絡先や設定を引き継いでくれます。`ai-switch` は AI コーディングツールに対して同じことをします。Claude Code と Codex を行き来する際、手作業で作り直すことになる**プロジェクトレベルの設定**を移行します。

アカウント・セッション・チャット履歴・プロジェクト外のシークレットには一切触れず、すべての変更はバックアップされ、元に戻せます。

---

## なぜ必要か

複数の AI コーディングエージェントを使うと、同じ設定 —— 指示ファイル・MCP サーバー・スキル —— を何度も書き直すことになります。`ai-switch` はこれを 1 つのコマンドで変換し、**安全に自動変換できない項目は黙って捨てずにレポート**します。

## 何を移行するか

| 種類 | Claude Code | Codex |
| --- | --- | --- |
| 指示 | `CLAUDE.md` | `AGENTS.md` |
| MCP サーバー | `.mcp.json`、`.claude/settings.json` | `.codex/config.toml` |
| スキル | `.claude/skills/` | `.codex/skills/` |

**対象外（意図的）：** アカウント、セッション、リモートのチャット履歴、API キー/シークレット。

## クイックスタート

```sh
# 現在のプロジェクトに何があるか確認
ai-switch status

# 移行のプレビュー（ファイルは書き込まない）
ai-switch convert cc codex --dry-run

# 適用（先にバックアップを作成）
ai-switch convert cc codex --yes

# やっぱりやめる？ ロールバック
ai-switch restore latest
```

プロジェクト変換はホームディレクトリ（`~`）ではなく、実際のリポジトリ/プロジェクトディレクトリで実行してください。ホームレベル設定は現在、読み取り専用で確認できます：

```sh
ai-switch status --global
```

開発中は Node または Bun で直接実行できます：

```sh
node ./src/cli.js status
bun run src/cli.js convert cc codex --dry-run
```

インストール：

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+ が必要
bunx @seungchan.m/ai-switch             # Bun が必要
```

## コマンド

| コマンド | 内容 |
| --- | --- |
| `status` | 現在のプロジェクトの読みやすい要約 |
| `status --global` | ホームレベル設定（`~/.claude`、`~/.codex`）の読み取り専用の要約 |
| `detect` | 検出ファイルの機械可読 JSON |
| `doctor` | 問題と警告を診断 |
| `convert <from> <to>` | 設定を移行（`cc` ↔ `codex`）。`--dry-run`、`--yes`、`--force` を付加可能 |
| `backups` | タイムスタンプ付きバックアップの一覧 |
| `restore latest \| <timestamp>` | バックアップを復元し移行を元に戻す |

`status` の出力例：

```text
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

グローバル status は `CLAUDE_CONFIG_DIR` / `CODEX_HOME` が設定されている場合、`~/.claude`・`~/.codex` を前提とせずそれらの場所に従います。

## 例

同梱の例でプレビュー —— dry run は何も書き込む前に、何が起こるかを正確に表示します：

```sh
node src/cli.js convert cc codex --dry-run --cwd examples/claude-project
```

```text
create        AGENTS.md
manual-review mcp: linear (HTTP サーバー —— stdio command/args/env のみ自動変換)
create        .codex/config.toml
copy          .claude/skills -> .codex/skills
report        ai-switch-report.md
```

例には stdio MCP サーバー 1 つ（自動移行）と HTTP MCP サーバー 1 つ（手動レビュー対象）をあえて含め、両方の経路を確認できるようにしています。

## 安全モデル

`ai-switch` はデフォルトで保守的です：

- 🔍 `--dry-run` は計画を表示するだけで何も書き込まない
- ✋ 書き込みには `--yes` が必要
- 🛡️ 既存ファイルは `--force` なしでは**上書きしない**
- 💾 すべての書き込みを `.ai-switch-backups/<timestamp>/` にスナップショット
- ↩️ `restore latest` は移行を元に戻す —— 元ファイルを復元し、作成したファイルを削除
- 🚫 移行で作成したファイルをその後編集した場合、`--force` なしでは削除を拒否

`.codex/config.toml` は上書きルールの唯一の例外です。移行は既存の内容を保持し、競合しない新しい MCP サーバーのみを追記します。

## サポート表

| 機能 | cc → codex | codex → cc |
| --- | --- | --- |
| プロジェクト指示 | ✅ | ✅ |
| Stdio MCP サーバー | ✅ | ✅ |
| HTTP/SSE MCP サーバー | 📝 手動レビュー | 📝 手動レビュー |
| ローカルスキル | ✅ コピー | ✅ コピー |
| 重複する MCP 名 | ⏭️ スキップ | — |
| アカウント / セッションデータ | ❌ | ❌ |
| リモートのチャット履歴 | ❌ | ❌ |
| ユーザーレベルのグローバル設定 | 🔎 status のみ | 🔎 status のみ |

## 変換マッピング

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` または `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio `command` のない HTTP/SSE サーバー → 手動レビューとしてレポート
- `.codex/config.toml` に既にある MCP 名 → スキップ（重複 TOML セクションを回避）
- `.claude/skills` → `.codex/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` の MCP セクション → `.mcp.json`
- stdio `command` のない Codex セクション → 手動レビューとしてレポート
- `.codex/skills` → `.claude/skills`

## 制限事項

- 自動 MCP 変換は stdio サーバー（`command`、`args`、`env`）のみ対応。リモートの HTTP/SSE サーバーは `ai-switch-report.md` に手動レビュー項目として記載されます。
- TOML 解析は意図的に最小限で、現在は単一行の `args` とインラインの `env` を前提とします。
- グローバル（ホームレベル）対応は現在**読み取り専用** —— `status --global` のみで、グローバルな `convert` はまだありません。

## ロードマップ

- Codex TOML 書き込み時にコメントと未知のフィールドを保持
- オプトインのグローバル（`convert --global`）対応
- npm 公開の自動化
- Gemini CLI、Cursor、Windsurf、Aider 向けアダプター

## コントリビュート

Issue と PR を歓迎します。本プロジェクトは**公開された挙動と文書化されたファイル形式のみ**から構築されています —— 独自・流出・リバースエンジニアリングによるソースは追加しないでください。[CONTRIBUTING.md](CONTRIBUTING.md) と [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[MIT](LICENSE)
