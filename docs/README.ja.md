# ai-switch

> **Claude Code** ↔ **Codex** 間でプロジェクト設定を移行 —— `CLAUDE.md`/`AGENTS.md`、MCP サーバー、スキル。バックアップ付きで、元に戻せます。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../LICENSE)

[English](../README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · **日本語**

Claude Code と Codex を行き来するたびに手で作り直すことになる**プロジェクト単位の設定**を運ぶ、依存ゼロの CLI です。すべての書き込みはバックアップされ、すべての実行は `--dry-run` でプレビューでき、安全に自動変換できないものは**捨てずにレポート**します。

アカウント、セッション、チャット履歴、シークレット値には一切触れません。

## なぜ必要か

AI コーディングツールはほぼ毎週改善されます。今日あるタスクに最適なツールが、来月も最適とは限りません —— 慣れているからと使い続けると、新しいツールが解き放つ生産性を静かに取りこぼします。生産性を最大化するには、最初に覚えたものではなく、*今*手に入る最良のツールを使うことです。

切り替えを苦痛にするのは、毎回**設定を手で作り直す**こと —— 指示、MCP サーバー、スキル。その摩擦こそが本当のロックインです。

`ai-switch` は設定を可搬にしてその摩擦を取り除きます。1 コマンドで変換し、たまたま設定したツールではなく最良のツールに従いましょう。今週は新しいものを試し、来週は戻し、プロジェクトごとに両方使うこともできます。安全に自動変換できないものは手動レビュー用にレポートされ、静かに捨てられることはありません。

## インストール

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+

# またはインストールせず一度だけ実行:
npx @seungchan.m/ai-switch status
```

## クイックスタート

```sh
ai-switch status                      # このプロジェクトには何がある?
ai-switch convert cc codex --dry-run  # プレビュー —— 何も書き込まない
ai-switch convert cc codex --yes      # 適用 —— まずバックアップ
ai-switch restore latest              # 取り消し
```

`cc` = Claude Code、`codex` = Codex。`convert codex cc` で逆方向に。

```text
$ ai-switch convert cc codex --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   ai-switch-report.md
```

## 移行する対象

| 領域 | Claude Code | Codex |
| --- | --- | --- |
| 指示 | `CLAUDE.md` | `AGENTS.md` |
| MCP サーバー | `.mcp.json`、`.claude/settings.json` | `.codex/config.toml` |
| スキル | `.claude/skills/` | `.agents/skills/`（+ `.codex/skills/`） |

設計上の対象外: アカウント、セッション、リモートチャット履歴、API キー / シークレット値。

## コマンド

| コマンド | 役割 |
| --- | --- |
| `status` | 現在のプロジェクトの要約（`--global` で `~/.claude`、`~/.codex`） |
| `detect` | 検出したファイルを機械可読な JSON で出力 |
| `audit` | すべての Claude 領域を migrated / manual / not-portable に分類 |
| `doctor` | 問題と警告をレポート |
| `convert <from> <to>` | 設定を移行（`cc` ↔ `codex`）。フラグ: `--dry-run`、`--yes`、`--force`、`--compile`、`--global` |
| `handoff` | git の状態から `CODEX-HANDOFF.md` の雛形を生成 —— 生のチャットは含めない |
| `backups` | タイムスタンプ付きバックアップ一覧 |
| `restore <latest\|timestamp>` | バックアップを復元し移行を取り消す |

```text
$ ai-switch status
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

## 安全モデル

デフォルトは保守的です:

- `--dry-run` は計画を表示するだけで何も書き込みません。
- 移行の書き込みには `--yes` が必要です。
- 既存ファイルは `--force` なしには**上書きしません**。
- すべての移行で元ファイルを `.ai-switch-backups/<timestamp>/` にスナップショットします（gitignore 済み）。
- `restore latest` は移行を取り消します —— 元を復元し、生成したファイルを削除 —— そしてその後あなたが編集した生成ファイルは（`--force` なしには）削除を拒否します。

`.codex/config.toml` は上書きルールの唯一の例外です。移行は既存の内容を保ち、衝突しない MCP サーバーだけを**追記**します。

## グローバル設定

プロジェクト変換はリポジトリのディレクトリで実行します。ホームレベル（`~/.claude`、`~/.codex`）の設定には独立した明示的な `--global` フラグを使います:

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch restore latest --global
```

`--global` は**許可リストのみ**です。`CLAUDE.md`/`AGENTS.md`、`settings.json#mcpServers`/`config.toml#mcp_servers`、`skills/` だけを触ります。`auth.json`、`sessions/`、`state_*.sqlite`、ログ、キャッシュは読みも書きもしません。設定時は `CLAUDE_CONFIG_DIR` / `CODEX_HOME` に従います。グローバルバックアップは `~/.ai-switch/backups/global/` にあります。

## サポート表

| 機能 | cc → codex | codex → cc |
| --- | --- | --- |
| プロジェクト指示 | あり | あり |
| Stdio MCP サーバー | あり | あり |
| HTTP MCP サーバー（`url`） | あり（認証は手動） | あり（認証は手動） |
| ローカルスキル | あり（コピー） | あり（コピー） |
| 重複する MCP 名 | スキップ | — |
| アカウント / セッションデータ | なし | なし |
| リモートチャット履歴 | なし | なし |
| グローバル設定 | あり（`--global`） | あり（`--global`） |

### 変換マッピング

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` または `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio サーバー → `command`/`args`/`env`；HTTP（`type: http`、`url`） → Codex の `url` サーバー（認証ヘッダーは手動設定として明示）
- `.codex/config.toml` に既にある MCP 名 → スキップ（重複セクションなし）
- `.claude/skills` → `.agents/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` の MCP セクション → `.mcp.json`；stdio → `command`/`args`/`env`、`url` → `{ "type": "http", "url" }`（bearer/ヘッダー認証は手動設定として明示）
- `.codex/skills` **と** `.agents/skills` → `.claude/skills`

## 認証情報とシークレット

MCP サーバーにはシークレット（API キー、トークン）が必要です。ai-switch が移行するのは**配線**だけ —— サーバー名、コマンド、引数、環境変数の*名前*。シークレットの**値**を他ツールの設定やレポートにコピーすることは決してありません。ソース内のリテラル値は **`$NAME` 参照に書き換えて** `ai-switch-report.md` に列挙するので、新しいツールに同じ環境変数を設定すれば動きます（漏れていたなら必ずローテーションを）。

> **バックアップとシークレット。** バックアップは**元の**ファイルを保持し、`restore` が正確に戻せるようにします。もし*ソース*設定に既にリテラルのシークレットがあれば、ローカルバックアップ（`.ai-switch-backups/`、`~/.ai-switch/backups/global/`；どちらも gitignore 済み）にも含まれ得ます。レポートは必ずこれを注記します。保証: ai-switch は*他ツールの*設定やレポートにリテラル値を決して書きません。

## `--compile`: 指示の階層を平坦化

デフォルトの `cc → codex` はルートの `CLAUDE.md` だけをコピーします。しかし Claude Code が読み込むのは*階層*です: `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@`-インポート。`--compile` はそのすべてを 1 つの `AGENTS.md` に合成し、各部分を `## From <source>` 見出しの下に置きます:

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # CLAUDE.local.md も取り込む
```

`@path` 行は `<!-- included from … -->` マーカー付きでインライン展開されます。デフォルトは安全です: `--include-local` なしでは `CLAUDE.local.md` を除外。インライン展開は 40KB 未満（合計 200KB）のリポジトリ相対テキストファイル（`.md/.txt/.json/.yaml/.yml/.toml`）の場合のみ。絶対/`~` パス、存在しないファイル、誤った型、循環インポートはそのまま残してレポートします —— 静かに捨てません。

## `handoff`: 安全なコンテキスト雛形

`ai-switch handoff` は次の agent のための独立した `CODEX-HANDOFF.md` を作ります。生のチャット・セッション・ファイル内容は**決して**読みません —— git 由来のプロジェクト状態と、git には分からない人間のコンテキスト用の空欄だけを埋めます。

```sh
ai-switch handoff                       # CODEX-HANDOFF.md を書き出す
ai-switch handoff --stdout              # 書かずに出力
ai-switch handoff --from codex --to cc  # 方向をラベル付け
```

git から自動入力: 現在のブランチ、変更ファイル（`git status`）、diff 要約（`git diff --stat`）、最近のコミット（`git log --oneline`）。空欄: 目標、決定事項、未着手 TODO、テスト方法、既知のリスク、メモ。`--from`/`--to` は雛形にラベルを付けるだけで、収集する git データは変えません。既存ファイルは `--force` なしには上書きせず、`AGENTS.md` を対象にすることはなく、絶対パスではなくプロジェクトの basename だけを記録します。

## 範囲と audit

ai-switch が移行するのは 3 つの領域 —— **指示、MCP サーバー、スキル**。Claude Code にはもっと多くがあり（`.claude/agents`、`.claude/commands`、settings の `hooks`/`permissions`、output styles…）、Codex に綺麗な 1 対 1 の対応はありません。そう装う代わりに、`audit` は見つけたすべてを列挙して分類します:

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

すべての移行レポートにも同じ **「Other Claude surfaces detected」** セクションが入るので、まだ完了していないのに完了したように見えることはありません。

## 制限

- 自動 MCP 変換は stdio（`command`/`args`/`env`）と HTTP（`url`）サーバーをカバーします。認証ヘッダー/bearer トークンは手動設定として明示され、コピーされません。
- 生のチャット履歴とプライベートセッションは決して移行しません —— 代わりに `handoff` で安全な git 由来の雛形を使ってください。
- `--global` は許可リストのみで、auth/session/state/log/cache ファイルには触れません。

## ロードマップ

- [x] 認証情報インベントリ + 複数行 TOML 解析（0.2.0）
- [x] グローバル `convert --global`、許可リストのみ（0.3.0）
- [x] `.agents/skills` + HTTP MCP `url` 変換（0.4.0）
- [x] `audit` —— 領域を migrated / manual / not-portable に分類（0.5.0）
- [x] `convert --compile` —— CLAUDE.md 階層の平坦化（0.6.0）
- [x] `handoff` —— git 由来のコンテキスト雛形（0.7.0）
- [ ] Gemini CLI と Cursor のアダプター
- [ ] Codex TOML 書き込み時にコメント/未知フィールドを保持
- [ ] 明示的な危険警告付きの opt-in `--include-env-values`

## コントリビュート

Issue と PR を歓迎します。本プロジェクトは**公開された挙動と文書化されたファイル形式のみ**から作られています —— 専有・流出・リバースエンジニアリングされたソースは追加しないでください。[CONTRIBUTING.md](../CONTRIBUTING.md) と [SECURITY.md](../SECURITY.md) を参照してください。

## ライセンス

[MIT](../LICENSE)
