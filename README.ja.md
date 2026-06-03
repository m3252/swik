# ai-switch

[English](README.md) · [한국어](README.ko.md) · [中文](README.zh.md) · **日本語**

> **Claude Code** と **Codex** の間で、プロジェクトのエージェント設定 —— 指示・MCP サーバー・スキル —— を安全かつ元に戻せる形で移行します。

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

新しいスマホに替えるとき、移行アプリが連絡先や設定を引き継いでくれます。`ai-switch` は AI コーディングツールに対して同じことをします。Claude Code と Codex を行き来する際、手作業で作り直すことになる**プロジェクトレベルの設定**を移行します。

アカウント・セッション・チャット履歴・プロジェクト外のシークレットには一切触れず、すべての変更はバックアップされ、元に戻せます。

---

## なぜ必要か

AI コーディングツールはほぼ毎週のように進化しています。今日いちばん良いツールが来月もそうとは限りません。慣れているという理由だけで使い慣れたツールに固執するのは、新しいツールがもたらす生産性向上を毎回取りこぼすことを意味します。賢い選択は、最初に覚えたツールではなく*いま最も良いツール*を使うことです。

乗り換えをためらわせる唯一の理由は、毎回**設定を手作業で作り直す**必要があることです —— 指示・MCP サーバー・スキルを一つずつ。この摩擦こそが、あなたを一つのツールに縛りつけています。

`ai-switch` は設定を持ち運び可能にすることで、その摩擦を取り除きます。1 つのコマンドで変換し、たまたま設定済みのツールではなく最も良いツールに従いましょう。今週は新しいものを試し、来週は戻り、プロジェクトごとに両方を使うのも自由です。安全に自動変換できない項目は黙って捨てず、**手動レビュー項目としてレポート**します。

## 何を移行するか

| 種類 | Claude Code | Codex |
| --- | --- | --- |
| 指示 | `CLAUDE.md` | `AGENTS.md` |
| MCP サーバー | `.mcp.json`、`.claude/settings.json` | `.codex/config.toml` |
| スキル | `.claude/skills/` | `.agents/skills/`（+ `.codex/skills/`） |

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

プロジェクト変換はホームディレクトリ（`~`）ではなく、実際のリポジトリ/プロジェクトディレクトリで実行してください。ホームレベル（グローバル）設定には専用の `--global` フラグがあります：

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch backups --global
ai-switch restore latest --global
```

グローバル convert は **allowlist 限定**です：`CLAUDE.md`/`AGENTS.md`、`settings.json#mcpServers`/`config.toml#mcp_servers`、`skills/` のみを扱います。`auth.json`、`sessions/`、`state_*.sqlite`、ログ、キャッシュは決して読み書きしません。グローバルバックアップは `~/.ai-switch/backups/global/` に保存されます。

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
create        .codex/config.toml
copy          .claude/skills -> .agents/skills
report        ai-switch-report.md
```

例には stdio MCP サーバーと HTTP MCP サーバーが含まれ —— どちらも自動移行されます（stdio → `command`、HTTP → `url`）。env 値の 1 つがリテラルのため、CLI はローカルバックアップがその値を保持する旨の警告も表示します。

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
| HTTP MCP サーバー（`url`） | ✅ url（auth は手動） | ✅ url（auth は手動） |
| ローカルスキル | ✅ コピー | ✅ コピー |
| 重複する MCP 名 | ⏭️ スキップ | — |
| アカウント / セッションデータ | ❌ | ❌ |
| リモートのチャット履歴 | ❌ | ❌ |
| ユーザーレベルのグローバル設定 | ✅ `--global`（allowlist） | ✅ `--global`（allowlist） |

## 変換マッピング

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` または `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio サーバー → `command`/`args`/`env`；HTTP サーバー（`type: http`、`url`）→ Codex の `url` サーバー（auth ヘッダーは手動設定としてフラグ）
- `.codex/config.toml` に既にある MCP 名 → スキップ（重複 TOML セクションを回避）
- `.claude/skills` → `.agents/skills`（Codex の現行スキル位置）

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` の MCP セクション → `.mcp.json`
- stdio → `command`/`args`/`env`、`url` サーバー → `{ "type": "http", "url" }`（bearer/ヘッダー auth は手動設定としてフラグ）
- `.codex/skills` **および** `.agents/skills` → `.claude/skills`

## 認証情報

MCP サーバーは通常シークレット（API キー、トークン）を必要とします。ai-switch は**配線** —— サーバー名・command・args・env 変数の*名前* —— のみを移行し、シークレットの**値**はツール間にもレポートにも決してコピーしません。移行後、`ai-switch-report.md` が移行済みサーバーに必要な認証情報の一覧を示すので、同じ環境変数を新しいツールに設定するだけで済みます。移行後の設定では、リテラル値は**`$NAME` 参照に書き換えられ**（値自体はターゲット設定にもレポートにも決してコピーされません）、レポートに一覧化されるので、環境変数に設定し、シークレットだった場合はローテーションしてください。

> **バックアップとシークレット。** バックアップは `restore` が正確に元へ戻せるよう、**元の** allowlist ファイルを保持します。*ソース*設定に既にリテラルのシークレットがある場合、ローカルバックアップ（プロジェクト: `.ai-switch-backups/`、グローバル: `~/.ai-switch/backups/global/`；いずれも gitignore 済み）にもそれが含まれることがあります。レポートは常にこれを記載し、CLI はさらにリテラルの **env 値**がある場合に警告します（HTTP auth ヘッダーは手動設定として別途フラグ）。保証するのは、ai-switch がリテラル値を*別ツール*の設定やレポートに決して書き込まないことです。

> ai-switch が移行するのは**永続的なエージェント指示と MCP 配線**であり、生のチャット履歴・プライベートセッション・シークレット値ではありません。

## 制限事項

- 自動 MCP 変換は stdio サーバー（`command`、`args`、`env`）と HTTP サーバー（`url`）に対応。HTTP サーバーの auth ヘッダー/ベアラートークンはコピーされず、`ai-switch-report.md` に手動設定項目として記載されます。
- **生のチャット履歴とプライベートセッションは決して移行しません** —— コード・シークレット・個人情報が混在しうえ、ツール間で意味が通じません。代わりに `handoff` 要約エクスポートを予定しています。
- グローバル `--global` convert は allowlist 限定で、auth/session/state/log/cache ファイルには決して触れません。allowlist の拡張は意図的に保守的にしています。

## ロードマップ

- ✅ 認証情報インベントリ —— 移行済み各 MCP サーバーが必要とする env 変数をレポート（0.2.0）
- ✅ 複数行 TOML `args`/`env` の解析（0.2.0）
- ✅ グローバル `convert --global`（allowlist 限定）—— ホームレベル設定（0.3.0）
- `handoff` —— 次のエージェント向けに簡潔なプロジェクト文脈の要約をエクスポート（生のチャットではない）
- Gemini CLI、Cursor 向けアダプター
- Codex TOML 書き込み時にコメントと未知のフィールドを保持
- オプトインの `--include-env-values`（シークレット値のコピー、明確な危険警告の後ろ）

## コントリビュート

Issue と PR を歓迎します。本プロジェクトは**公開された挙動と文書化されたファイル形式のみ**から構築されています —— 独自・流出・リバースエンジニアリングによるソースは追加しないでください。[CONTRIBUTING.md](CONTRIBUTING.md) と [SECURITY.md](SECURITY.md) を参照してください。

## ライセンス

[MIT](LICENSE)
