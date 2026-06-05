# swik

> **Claude Code** と **Codex** の間でプロジェクト設定を移動します: 指示、MCP サーバー、スキル。まずプレビューし、書き込みは毎回バックアップし、必要なら復元できます。

[![CI](https://github.com/m3252/swik/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/swik/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/swik)](https://www.npmjs.com/package/swik)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

[English](../README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · **日本語**

`swik` は、Claude Code と Codex の間でプロジェクトを切り替えるときに、同じ設定を手で作り直さなくて済むようにするゼロ依存 CLI です。移植可能なプロジェクト設定だけを移行し、手作業が必要なものはレポートします。アカウント、セッション、チャット履歴、シークレット値には触れません。

## すぐ試す

インストールせずに一度だけ実行:

```sh
npx swik status
npx swik convert cc codex --dry-run
```

グローバルにインストール:

```sh
npm install -g swik
```

インストール後は `swik` を使います:

```sh
swik status
swik sync --compile --dry-run
```

完全なコマンド名 `swik` も引き続き使えますが、文書の例では非 scoped npm package との混同を避けるため `swik` を優先します。

## よく使う流れ

両方のツールを安全に同期:

```sh
swik sync --compile --dry-run
swik sync --compile --yes
```

### Claude Code から Codex

まずプレビュー:

```sh
swik audit
swik convert cc codex --compile --dry-run
```

計画を確認してから適用:

```sh
swik convert cc codex --compile --yes
```

Claude の指示階層を `AGENTS.md` にまとめたいときは `--compile` を使います:

```text
CLAUDE.md
.claude/CLAUDE.md
.claude/rules/*.md
安全な @include ファイル
```

### Codex から Claude Code

```sh
swik convert codex cc --dry-run
swik convert codex cc --yes
```

### 移行を取り消す

```sh
swik backups
swik restore latest
```

### Handoff ファイルを作る

```sh
swik handoff --stdout
swik handoff --from codex --to cc
swik handoff
```

`handoff` は git メタデータだけから `CODEX-HANDOFF.md` を作ります。生のチャット、セッション、ファイル内容は読みません。

### Home レベル設定

`~/.claude` / `~/.codex` の許可リスト内設定を意図して確認・移行するときだけ `--global` を使います:

```sh
swik status --global
swik convert cc codex --global --dry-run
swik convert cc codex --global --yes
swik restore latest --global
```

## 移行するもの

| 領域 | Claude Code | Codex | メモ |
| --- | --- | --- | --- |
| 指示 | `CLAUDE.md` | `AGENTS.md` | `--compile` で Claude の指示階層を 1 ファイルにまとめられます |
| MCP サーバー | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` | stdio と HTTP URL サーバー。認証は手作業で確認 |
| スキル | `.claude/skills/` | `.agents/skills/` | ローカルスキルフォルダとしてコピー |

## 互換性ベースライン

swik 0.8.x の test fixture は、2026-06 時点の Claude Code 2.1.162 と Codex CLI 0.136.0 の project config shape を基準にしています。自動変換するのは上表の portable subset だけで、それ以外のフィールドはレポートまたは手作業扱いです。

設計上、対象外のもの:

- アカウントとログイン状態
- リモートのチャット履歴とプライベートセッション
- API key とシークレットの生値
- Codex にきれいな対応先がない Claude 専用領域

## 出力例

```text
$ swik convert cc codex --compile --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   swik-report.md
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

## コマンドリファレンス

| コマンド | コピーして使える例 |
| --- | --- |
| プロジェクトを確認 | `swik status` |
| 検出結果を機械可読で出力 | `swik detect` |
| Claude 領域を監査 | `swik audit` |
| ヘルスチェック | `swik doctor` |
| 両方のツールを安全に同期 | `swik sync --compile --dry-run` |
| Claude Code -> Codex をプレビュー | `swik convert cc codex --compile --dry-run` |
| Claude Code -> Codex を適用 | `swik convert cc codex --compile --yes` |
| Codex -> Claude Code をプレビュー | `swik convert codex cc --dry-run` |
| Codex -> Claude Code を適用 | `swik convert codex cc --yes` |
| バックアップ一覧 | `swik backups` |
| 最新バックアップを復元 | `swik restore latest` |
| handoff を生成 | `swik handoff` |
| handoff を表示だけする | `swik handoff --stdout` |
| グローバル状態 | `swik status --global` |

Provider alias:

```text
cc = claude = claude-code
codex = codex
```

便利なフラグ:

| フラグ | 意味 |
| --- | --- |
| `--dry-run` | 変更をプレビューし、何も書きません |
| `--yes` | 移行でファイルを書き込むことを許可します |
| `--force` | 保護されているファイルの上書きを許可します |
| `--compile` | Claude の指示階層を `AGENTS.md` に合成します |
| `--include-local` | `--compile` 時に `CLAUDE.local.md` を含めます |
| `--global` | 許可リスト内の Home レベル設定を操作します |
| `--stdout` | handoff をファイルに書かず標準出力に出します |

## 安全モデル

デフォルトは保守的です:

- `--dry-run` は計画だけを表示し、書き込みません。
- 移行の書き込みには `--yes` が必要です。
- 既存ファイルは `--force` なしでは上書きしません。
- すべての移行で元ファイルを `.swik-backups/<timestamp>/` にスナップショットします。
- Git worktree 内でプロジェクトに書き込む前に、`.swik-backups/` と `swik-report.md` を `.git/info/exclude` に追加します。
- `restore latest` は元ファイルを復元し、移行で作られたファイルを削除します。
- 移行後にあなたが編集した生成ファイルは、`--force` なしでは削除を拒否します。

`.codex/config.toml` だけは上書きルールの例外です。既存内容を保ち、衝突しない MCP サーバーだけを追記します。

## 認証情報とシークレット

MCP サーバーには API key や token が必要なことがあります。swik は配線だけを移行します。つまりサーバー名、コマンド、引数、環境変数名です。シークレット値を別ツールの設定やレポートへコピーすることはありません。

ソース設定に env の生値がある場合、swik はターゲット設定では `$NAME` 参照に書き換え、その変数を `swik-report.md` に列挙します。

バックアップは正確なロールバックのために元ファイルを保持します。ソース設定がすでにシークレットの生値を含む場合、ローカルバックアップにも含まれる可能性があります。プロジェクトバックアップは `.swik-backups/` に置かれ、Git repository では書き込み前にこのディレクトリと `swik-report.md` を `.git/info/exclude` に追加します。グローバルバックアップはプロジェクト外の `~/.swik/backups/global/` にあります。

## Compile Instructions

デフォルトでは、`cc -> codex` はルートの `CLAUDE.md` だけをコピーします。

`--compile` を使うと、swik はソースラベル付きの `AGENTS.md` を書きます:

```sh
swik convert cc codex --compile --dry-run
swik convert cc codex --compile --yes
swik convert cc codex --compile --include-local --yes
```

合成出力の例:

```md
# Project Instructions

Compiled from Claude Code by swik (--compile).

## From CLAUDE.md
...

## From .claude/rules/style.md
...
```

安全な `@path` include はソースマーカー付きでインライン化されます。絶対パス、`~` パス、存在しないファイル、未対応のファイル種別、大きすぎるファイル、循環 include はそのまま残され、レポートされます。

## Handoff

`swik handoff` は次の agent 向けに独立した `CODEX-HANDOFF.md` の雛形を書きます:

```sh
swik handoff
swik handoff --stdout
swik handoff --from codex --to cc
```

git から自動入力:

- 現在のブランチ
- `git status` の変更ファイル
- `git diff --stat` の diff summary
- `git log --oneline` の最近のコミット

あなたが埋める欄:

- 目標
- 決定事項
- 未完了 TODO
- テスト方法
- 既知のリスク
- メモ

記録されるのはプロジェクト basename だけで、ローカルの絶対パスは記録しません。

## 制限

- 自動 MCP 変換は stdio（`command`/`args`/`env`）と HTTP（`url`）サーバーを対象にします。
- 認証 header と bearer token は手作業として表示し、コピーしません。
- Claude custom agents、commands、hooks、permissions、output styles は、移植可能なふりをせずレポートします。
- 生のチャット履歴とプライベートセッションは移行しません。
- `--global` は許可リストのみで、auth/session/state/log/cache ファイルには触れません。
- Codex TOML の書き込みは現在 append-oriented です。今のゼロ依存 parser は対応 MCP subset を扱うもので、コメント/未知フィールド保持には先に AST-backed TOML parser/writer が必要です。

## ロードマップ

- [x] 認証情報インベントリ + 複数行 TOML 解析（0.2.0）
- [x] グローバル `convert --global`、許可リストのみ（0.3.0）
- [x] `.agents/skills` + HTTP MCP `url` 変換（0.4.0）
- [x] `audit` — 領域を migrated / manual / not-portable に分類（0.5.0）
- [x] `convert --compile` — CLAUDE.md 階層の平坦化（0.6.0）
- [x] `handoff` — git 由来のコンテキスト雛形（0.7.0）
- [x] `sync` — 安全な双方向プロジェクト設定 reconcile（0.8.0）
- [x] バックアップとレポートのための project-local `.git/info/exclude` 保護（0.8.2）
- [ ] Gemini CLI と Cursor のアダプター
- [ ] Codex TOML のコメント/未知フィールド保持前に AST-backed parser/writer を導入
- [ ] 明示的な危険警告付きの opt-in `--include-env-values`

## コントリビュート

Issue と PR を歓迎します。本プロジェクトは公開された挙動と文書化されたファイル形式のみから作られています。専有、流出、リバースエンジニアリングされたソースは追加しないでください。[CONTRIBUTING.md](../CONTRIBUTING.md) と [SECURITY.md](../SECURITY.md) を参照してください。

## ライセンス

[MIT](../LICENSE)
