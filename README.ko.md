# ai-switch

[English](README.md) · **한국어** · [中文](README.zh.md) · [日本語](README.ja.md)

> **Claude Code**와 **Codex** 사이에서 프로젝트의 에이전트 설정 — 인스트럭션, MCP 서버, 스킬 — 을 안전하게, 되돌릴 수 있게 옮겨줍니다.

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

새 휴대폰으로 바꿀 때 이전 앱이 연락처와 설정을 옮겨주듯, `ai-switch`는 AI 코딩 도구에 같은 일을 합니다. Claude Code와 Codex를 오갈 때 손으로 다시 만들어야 하는 **프로젝트 레벨 설정**을 한 번에 옮겨줍니다.

계정, 세션, 대화 기록, 프로젝트 밖 시크릿은 절대 건드리지 않으며, 모든 변경은 백업되어 되돌릴 수 있습니다.

---

## 왜 필요한가

AI 코딩 도구는 거의 매주 빠르게 발전합니다. 오늘 가장 좋은 도구가 다음 달에도 최고라는 보장은 없습니다. 익숙하다는 이유만으로 쓰던 도구를 고집하는 건, 새 도구가 주는 생산성 향상을 매번 놓치는 셈입니다. 현명한 선택은 처음 익힌 도구가 아니라 *지금 이 순간 가장 좋은 도구*를 쓰는 것입니다.

전환을 망설이게 만드는 단 하나의 이유는, 매번 **설정을 손으로 다시 만들어야 한다**는 것입니다 — 인스트럭션, MCP 서버, 스킬을 일일이. 이 마찰이 사실상 당신을 한 도구에 묶어 둡니다.

`ai-switch`는 그 설정을 이식 가능하게 만들어 이 마찰을 없앱니다. 한 명령으로 변환해서, 우연히 설정해 둔 도구가 아니라 가장 좋은 도구를 따라가세요. 이번 주엔 새 도구를 써 보고, 다음 주엔 돌아오고, 프로젝트마다 다른 도구를 돌려도 됩니다. 안전하게 자동 변환할 수 없는 항목은 조용히 버리지 않고 **수동 검토 항목으로 리포트**합니다.

## 무엇을 옮기나

| 종류 | Claude Code | Codex |
| --- | --- | --- |
| 인스트럭션 | `CLAUDE.md` | `AGENTS.md` |
| MCP 서버 | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` |
| 스킬 | `.claude/skills/` | `.agents/skills/` (+ `.codex/skills/`) |

**범위 밖 (의도적):** 계정, 세션, 원격 대화 기록, API 키/시크릿.

## 빠른 시작

```sh
# 현재 프로젝트에 무엇이 있는지 확인
ai-switch status

# 마이그레이션 미리보기 (파일 쓰기 없음)
ai-switch convert cc codex --dry-run

# 적용 (먼저 백업 생성)
ai-switch convert cc codex --yes

# 마음이 바뀌었다면 되돌리기
ai-switch restore latest
```

프로젝트 변환은 홈 디렉터리(`~`)가 아니라 실제 저장소/프로젝트 디렉터리에서 실행하세요. 홈 레벨(글로벌) 설정은 별도의 `--global` 플래그를 씁니다:

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch backups --global
ai-switch restore latest --global
```

글로벌 convert는 **allowlist 전용**입니다: `CLAUDE.md`/`AGENTS.md`, `settings.json#mcpServers`/`config.toml#mcp_servers`, `skills/`만 다룹니다. `auth.json`, `sessions/`, `state_*.sqlite`, 로그, 캐시는 절대 읽거나 쓰지 않습니다. 글로벌 백업은 `~/.ai-switch/backups/global/`에 저장됩니다.

개발 중에는 Node나 Bun으로 직접 실행할 수 있습니다:

```sh
node ./src/cli.js status
bun run src/cli.js convert cc codex --dry-run
```

설치:

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+ 필요
bunx @seungchan.m/ai-switch             # Bun 필요
```

## 명령어

| 명령 | 설명 |
| --- | --- |
| `status` | 현재 프로젝트의 사람이 읽기 좋은 요약 |
| `status --global` | 홈 레벨 설정(`~/.claude`, `~/.codex`)의 읽기 전용 요약 |
| `detect` | 감지된 파일의 기계용 JSON |
| `audit` | 모든 Claude 표면을 자동/수동/불가로 분류 |
| `doctor` | 문제와 경고 진단 |
| `handoff` | git 상태에서 `CODEX-HANDOFF.md` 스캐폴드 생성 (raw 채팅 없음) |
| `convert <from> <to>` | 설정 변환 (`cc` ↔ `codex`). `--dry-run`, `--yes`, `--force` 추가 가능 |
| `backups` | 타임스탬프 백업 목록 |
| `restore latest \| <timestamp>` | 백업 복원 및 마이그레이션 되돌리기 |

`status` 출력 예시:

```text
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

글로벌 status는 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`가 설정되어 있으면 `~/.claude`·`~/.codex`를 가정하지 않고 해당 위치를 따릅니다.

## 예제

번들 예제로 미리보기 — dry run은 파일을 쓰기 전에 무슨 일이 일어날지 정확히 보여줍니다:

```sh
node src/cli.js convert cc codex --dry-run --cwd examples/claude-project
```

```text
create        AGENTS.md
create        .codex/config.toml
copy          .claude/skills -> .agents/skills
report        ai-switch-report.md
```

예제에는 stdio MCP 서버와 HTTP MCP 서버가 들어 있고 — 둘 다 자동 변환됩니다(stdio → `command`, HTTP → `url`). env 값 중 리터럴이 있어서, CLI가 로컬 백업이 그 값을 보존한다는 경고도 함께 출력합니다.

## 안전 모델

`ai-switch`는 기본적으로 보수적입니다:

- 🔍 `--dry-run`은 계획만 출력하고 아무것도 쓰지 않음
- ✋ 마이그레이션 쓰기에는 `--yes` 필요
- 🛡️ 기존 파일은 `--force` 없이 **덮어쓰지 않음**
- 📝 `handoff`는 `CODEX-HANDOFF.md`(또는 `--output`)만 쓰고, `--force` 없이는 덮어쓰지 않음
- 💾 마이그레이션 쓰기는 `.ai-switch-backups/<timestamp>/`에 스냅샷
- ↩️ `restore latest`는 마이그레이션을 되돌림 — 원본 복원 + 생성된 파일 제거
- 🚫 마이그레이션이 만든 파일을 이후 수정했다면 `--force` 없이는 삭제 거부

`.codex/config.toml`은 덮어쓰기 규칙의 유일한 예외입니다. 마이그레이션은 기존 내용을 보존하고 충돌하지 않는 새 MCP 서버만 추가합니다.

## 지원 매트릭스

| 기능 | cc → codex | codex → cc |
| --- | --- | --- |
| 프로젝트 인스트럭션 | ✅ | ✅ |
| Stdio MCP 서버 | ✅ | ✅ |
| HTTP MCP 서버 (`url`) | ✅ url (auth 수동) | ✅ url (auth 수동) |
| 로컬 스킬 | ✅ 복사 | ✅ 복사 |
| 중복 MCP 이름 | ⏭️ 건너뜀 | — |
| 계정 / 세션 데이터 | ❌ | ❌ |
| 원격 대화 기록 | ❌ | ❌ |
| 사용자 레벨 글로벌 설정 | ✅ `--global` (allowlist) | ✅ `--global` (allowlist) |

## 변환 매핑

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 또는 `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio 서버 → `command`/`args`/`env`; HTTP 서버(`type: http`, `url`) → Codex `url` 서버 (auth 헤더는 수동 설정으로 표시)
- `.codex/config.toml`에 이미 있는 MCP 이름 → 건너뜀(중복 TOML 섹션 방지)
- `.claude/skills` → `.agents/skills` (Codex 현재 스킬 위치)

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml`의 MCP 섹션 → `.mcp.json`
- stdio → `command`/`args`/`env`, `url` 서버 → `{ "type": "http", "url" }` (bearer/헤더 auth는 수동 설정으로 표시)
- `.codex/skills` **및** `.agents/skills` → `.claude/skills`

## 자격증명

MCP 서버는 보통 시크릿(API 키, 토큰)이 필요합니다. ai-switch는 **배선** — 서버 이름, command, args, env 변수 *이름* — 만 옮기고, 시크릿 **값**은 도구 간에도 리포트에도 절대 복사하지 않습니다. 마이그레이션 후 `ai-switch-report.md`가 마이그레이션된 서버에 필요한 자격증명 목록을 보여주므로, 같은 환경변수만 새 도구에 설정하면 됩니다. 변환된 설정에서 리터럴 값은 **`$NAME` 참조로 다시 쓰여**(값 자체는 target config나 report에 절대 복사되지 않음) 표시되니, 환경변수로 설정하고 시크릿이었다면 교체하세요.

> **백업과 시크릿.** 백업은 `restore`가 정확히 되돌릴 수 있도록 **원본** allowlist 파일을 보존합니다. *source* 설정에 이미 리터럴 시크릿이 있으면 로컬 백업(프로젝트: `.ai-switch-backups/`, 글로벌: `~/.ai-switch/backups/global/`; 둘 다 gitignored)에도 포함될 수 있습니다. report는 항상 이를 안내하고, CLI는 추가로 리터럴 **env 값**이 있을 때 경고합니다(HTTP auth 헤더는 수동 설정으로 별도 표시). 보장하는 것은 ai-switch가 리터럴 값을 *다른 도구의* 설정이나 report에 절대 쓰지 않는다는 것입니다.

> ai-switch는 **지속적인 에이전트 인스트럭션과 MCP 배선**을 옮깁니다 — raw 채팅 기록, 비공개 세션, 시크릿 값은 옮기지 않습니다.

## 인스트럭션 계층 컴파일 (`--compile`)

기본 `cc → codex` 변환은 루트 `CLAUDE.md`만 `AGENTS.md`로 옮깁니다. 하지만 Claude Code는 실제로 `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@` include 계층을 읽습니다. `--compile`을 쓰면 이 계층을 하나의 `AGENTS.md`로 합성하고, 각 조각을 `## From <source>` 헤더 아래에 넣어 출처를 추적할 수 있게 합니다:

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # CLAUDE.local.md도 함께 합성
```

- `@path` 줄은 `<!-- included from … -->` 마커와 함께 인라인됩니다.
- **기본은 안전 우선:** `CLAUDE.local.md`는 `--include-local`을 넘길 때만 포함됩니다. include는 프로젝트 내부의 텍스트 파일(`.md/.txt/.json/.yaml/.yml/.toml`)이고 40KB 이하(전체 200KB 이하)일 때만 인라인됩니다. 절대경로/`~` 경로, 누락 파일, 잘못된 타입, 순환 include는 **원래 줄을 남기고 수동 검토 항목으로 report**합니다.
- `--compile` 없는 기본 변환 동작은 그대로입니다.

## handoff 스캐폴드 (`handoff`)

`ai-switch handoff`는 다음 에이전트를 위한 단독 `CODEX-HANDOFF.md`를 생성합니다. raw 채팅 기록, 세션, 파일 내용은 **읽지 않습니다**. git에서 안전하게 파생 가능한 프로젝트 상태만 채우고, git이 알 수 없는 사람의 판단 영역은 구조화된 빈칸으로 남깁니다:

```sh
ai-switch handoff
ai-switch handoff --stdout
ai-switch handoff --from codex --to cc
ai-switch handoff --output docs/CODEX-HANDOFF.md
ai-switch handoff --force
```

선택 옵션 `--from`/`--to`(`cc` 또는 `codex`)는 handoff 방향을 표시하는 라벨일 뿐이며, 수집하는 git 데이터에는 영향을 주지 않습니다.

git에서 자동 채움:

- 현재 브랜치
- `git status` 기반 변경 파일
- `git diff --stat` 기반 diff 요약
- `git log --oneline` 기반 최근 커밋

빈칸으로 남김:

- 목표
- 결정 사항
- 남은 TODO
- 테스트 방법
- 알려진 리스크
- 다음 에이전트를 위한 메모

기본 출력은 프로젝트 루트의 `CODEX-HANDOFF.md`입니다. 기존 파일은 `--force` 없이는 덮어쓰지 않으며, `AGENTS.md`는 handoff 대상으로 쓰지 않습니다. 기본적으로 handoff에는 절대 로컬 경로가 아니라 프로젝트 basename만 기록됩니다.

## 범위 & audit

ai-switch가 옮기는 표면은 셋 — **인스트럭션, MCP 서버, 스킬**입니다. Claude Code엔 더 많은 표면(`.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules`, `.claude/agents`, `.claude/commands`, settings의 `hooks`/`permissions`/…)이 있고, 이들은 Codex와 1:1로 깔끔히 대응되지 않습니다. 그래서 변환된 척하는 대신, `ai-switch audit`이 발견한 모든 것을 분류해 보여줍니다:

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

모든 마이그레이션 report에도 **"Other Claude surfaces detected"** 섹션(미변환 갭)이 포함되어, 변환이 실제로 안 끝났는데 끝난 것처럼 보이지 않게 합니다. `doctor`는 갭이 있으면 `audit`을 안내합니다.

## 제한 사항

- 자동 MCP 변환은 stdio 서버(`command`, `args`, `env`)와 HTTP 서버(`url`)를 지원하며, HTTP 서버의 auth 헤더/베어러 토큰은 복사하지 않고 `ai-switch-report.md`에 수동 설정 항목으로 표시됩니다.
- **raw 채팅 기록과 비공개 세션은 절대 옮기지 않습니다** — 코드·시크릿·개인정보가 섞여 있을 수 있고 도구 간에 의미가 통하지 않습니다. 대신 `ai-switch handoff`로 git 기반 스캐폴드를 만들 수 있습니다.
- 글로벌 `--global` convert는 allowlist 전용이며 auth/session/state/log/cache 파일은 절대 건드리지 않습니다. allowlist 확장은 의도적으로 보수적입니다.

## 로드맵

- ✅ 자격증명 인벤토리 — 마이그레이션된 각 MCP 서버에 필요한 env 변수를 리포트 (0.2.0)
- ✅ 멀티라인 TOML `args`/`env` 파싱 (0.2.0)
- ✅ 글로벌 `convert --global` (allowlist 전용) — 홈 레벨 설정 (0.3.0)
- ✅ `.agents/skills` 커버리지 + HTTP MCP `url` 변환 (0.4.0)
- ✅ `audit` — Claude 표면을 자동/수동/불가로 분류 (0.5.0)
- ✅ `convert --compile` — CLAUDE.md 계층(`.claude/rules`, `@` include)을 AGENTS.md로 합성 (0.6.0)
- ✅ `handoff` — 다음 에이전트를 위한 간결한 프로젝트 컨텍스트 스캐폴드 내보내기 (raw 채팅 아님) (0.7.0)
- Gemini CLI, Cursor용 어댑터
- Codex TOML을 쓸 때 주석과 알 수 없는 필드 보존
- 옵트인 `--include-env-values` (시크릿 값 복사, 명시적 위험 경고 뒤에)

## 기여

이슈와 PR 환영합니다. 이 프로젝트는 **공개된 동작과 문서화된 파일 포맷만**을 기반으로 합니다 — 독점·유출·역공학 소스는 추가하지 말아 주세요. [CONTRIBUTING.md](CONTRIBUTING.md)와 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
