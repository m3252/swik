# ai-switch

> **Claude Code** ↔ **Codex** 프로젝트 설정 마이그레이션 — `CLAUDE.md`/`AGENTS.md`, MCP 서버, 스킬. 백업과 함께, 되돌릴 수 있게.

[![CI](https://github.com/m3252/ai-switch/actions/workflows/ci.yml/badge.svg)](https://github.com/m3252/ai-switch/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@seungchan.m/ai-switch)](https://www.npmjs.com/package/@seungchan.m/ai-switch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) · **한국어** · [中文](README.zh.md) · [日本語](README.ja.md)

Claude Code와 Codex를 오갈 때 손으로 다시 만들어야 하는 **프로젝트 단위 설정**을 옮겨주는 의존성 0짜리 CLI입니다. 모든 쓰기는 백업되고, 모든 실행은 `--dry-run`으로 미리 볼 수 있으며, 안전하게 자동 변환할 수 없는 건 **버리지 않고 리포트**합니다.

계정, 세션, 채팅 기록, 비밀값에는 절대 손대지 않습니다.

## 왜 필요한가

AI 코딩 도구는 거의 매주 개선됩니다. 오늘 어떤 작업에 가장 좋은 도구가 다음 달에도 최선이라는 보장은 없습니다 — 익숙하다는 이유로 쓰던 걸 계속 쓰면, 더 나은 도구가 열어주는 생산성을 조용히 놓치게 됩니다. 생산성을 극대화하려면 처음 배운 도구가 아니라 *지금* 가장 좋은 도구를 써야 합니다.

전환을 고통스럽게 만드는 건 매번 **설정을 손으로 다시 만들어야 한다는 것** — 지시문, MCP 서버, 스킬. 그 마찰이 진짜 락인입니다.

`ai-switch`는 설정을 이식 가능하게 만들어 그 마찰을 없앱니다. 한 명령으로 변환하고, 우연히 설정해 둔 도구가 아니라 가장 좋은 도구를 따라가세요: 이번 주엔 새 걸 시도하고, 다음 주엔 되돌리고, 프로젝트별로 둘 다 쓰는 것도 가능합니다. 안전하게 자동 변환할 수 없는 건 수동 검토용으로 리포트되며, 절대 조용히 버려지지 않습니다.

## 설치

```sh
npm install -g @seungchan.m/ai-switch   # Node 20+

# 또는 설치 없이 한 번만 실행:
npx @seungchan.m/ai-switch status
```

## 빠른 시작

```sh
ai-switch status                      # 이 프로젝트엔 뭐가 있나?
ai-switch convert cc codex --dry-run  # 미리보기 — 아무것도 안 씀
ai-switch convert cc codex --yes      # 적용 — 먼저 백업
ai-switch restore latest              # 되돌리기
```

`cc` = Claude Code, `codex` = Codex. 방향은 `convert codex cc`로 반대로.

```text
$ ai-switch convert cc codex --dry-run
create   AGENTS.md
create   .codex/config.toml
copy     .claude/skills -> .agents/skills
report   ai-switch-report.md
```

## 옮기는 대상

| 영역 | Claude Code | Codex |
| --- | --- | --- |
| 지시문 | `CLAUDE.md` | `AGENTS.md` |
| MCP 서버 | `.mcp.json`, `.claude/settings.json` | `.codex/config.toml` |
| 스킬 | `.claude/skills/` | `.agents/skills/` (+ `.codex/skills/`) |

설계상 범위 밖: 계정, 세션, 원격 채팅 기록, API 키 / 비밀값.

## 명령어

| 명령 | 설명 |
| --- | --- |
| `status` | 현재 프로젝트 요약 (`--global`로 `~/.claude`, `~/.codex`) |
| `detect` | 감지된 파일을 기계가 읽는 JSON으로 |
| `audit` | 모든 Claude 영역을 migrated / manual / not-portable로 분류 |
| `doctor` | 문제·경고 리포트 |
| `convert <from> <to>` | 설정 마이그레이션 (`cc` ↔ `codex`). 플래그: `--dry-run`, `--yes`, `--force`, `--compile`, `--global` |
| `handoff` | git 상태로 `CODEX-HANDOFF.md` 스캐폴드 생성 — 원시 채팅은 절대 안 씀 |
| `backups` | 타임스탬프 백업 목록 |
| `restore <latest\|timestamp>` | 백업 복원 및 마이그레이션 되돌리기 |

```text
$ ai-switch status
Claude Code  CLAUDE.md, 2 MCP servers (.mcp.json), 1 skill
Codex        no AGENTS.md, no MCP config, no skills
```

## 안전 모델

기본값은 보수적입니다:

- `--dry-run`은 계획만 출력하고 아무것도 쓰지 않습니다.
- 마이그레이션 쓰기는 `--yes`가 필요합니다.
- 기존 파일은 `--force` 없이 **덮어쓰지 않습니다**.
- 모든 마이그레이션은 원본을 `.ai-switch-backups/<timestamp>/`에 스냅샷합니다 (gitignore됨).
- `restore latest`는 마이그레이션을 되돌립니다 — 원본 복원, 생성한 파일 제거 — 그리고 그 이후 직접 수정한 생성 파일은 (`--force` 없이는) 삭제를 거부합니다.

`.codex/config.toml`은 덮어쓰기 규칙의 유일한 예외입니다: 기존 내용을 보존하고 충돌하지 않는 MCP 서버만 **추가**합니다.

## 전역 설정

프로젝트 변환은 레포 디렉터리에서 실행합니다. 홈 레벨(`~/.claude`, `~/.codex`) 설정은 명시적 `--global` 플래그를 따로 씁니다:

```sh
ai-switch status --global
ai-switch convert cc codex --global --dry-run
ai-switch convert cc codex --global --yes
ai-switch restore latest --global
```

`--global`은 **허용목록 전용**입니다: `CLAUDE.md`/`AGENTS.md`, `settings.json#mcpServers`/`config.toml#mcp_servers`, `skills/`만 건드립니다. `auth.json`, `sessions/`, `state_*.sqlite`, 로그, 캐시는 읽지도 쓰지도 않습니다. 설정 시 `CLAUDE_CONFIG_DIR` / `CODEX_HOME`를 따릅니다. 전역 백업은 `~/.ai-switch/backups/global/`에 있습니다.

## 지원 매트릭스

| 기능 | cc → codex | codex → cc |
| --- | --- | --- |
| 프로젝트 지시문 | 예 | 예 |
| Stdio MCP 서버 | 예 | 예 |
| HTTP MCP 서버 (`url`) | 예 (인증 수동) | 예 (인증 수동) |
| 로컬 스킬 | 예 (복사) | 예 (복사) |
| 중복 MCP 이름 | 건너뜀 | — |
| 계정 / 세션 데이터 | 아니오 | 아니오 |
| 원격 채팅 기록 | 아니오 | 아니오 |
| 전역 설정 | 예 (`--global`) | 예 (`--global`) |

### 변환 매핑

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 또는 `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio 서버 → `command`/`args`/`env`; HTTP(`type: http`, `url`) → Codex `url` 서버 (인증 헤더는 수동 설정 표시)
- `.codex/config.toml`에 이미 있는 MCP 이름 → 건너뜀 (중복 섹션 없음)
- `.claude/skills` → `.agents/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml` MCP 섹션 → `.mcp.json`; stdio → `command`/`args`/`env`, `url` → `{ "type": "http", "url" }` (bearer/헤더 인증은 수동 설정 표시)
- `.codex/skills` **와** `.agents/skills` → `.claude/skills`

## 자격 증명과 비밀값

MCP 서버는 비밀값(API 키, 토큰)이 필요합니다. ai-switch는 **배선**만 옮깁니다 — 서버 이름, 명령, 인자, 환경변수 *이름*. 비밀 **값**은 다른 도구의 설정이나 리포트에 절대 복사하지 않습니다. 소스에 있던 리터럴 값은 **`$NAME` 참조로 다시 써서** `ai-switch-report.md`에 나열하므로, 새 도구에 같은 환경변수를 설정하면 됩니다 (유출됐다면 교체하세요).

> **백업과 비밀값.** 백업은 **원본** 파일을 보존해 `restore`가 정확히 되돌리게 합니다. 만약 *소스* 설정에 이미 리터럴 비밀값이 있다면 로컬 백업(`.ai-switch-backups/`, `~/.ai-switch/backups/global/`; 둘 다 gitignore됨)에도 들어갈 수 있고, 리포트는 항상 이를 알립니다. 보장: ai-switch는 *다른 도구의* 설정이나 리포트에 리터럴 값을 절대 쓰지 않습니다.

## `--compile`: 지시문 계층 평탄화

기본 `cc → codex`는 루트 `CLAUDE.md`만 복사합니다. 하지만 Claude Code는 *계층*을 로드합니다: `CLAUDE.md` + `.claude/CLAUDE.md` + `.claude/rules/*.md` + `@`-임포트. `--compile`은 이 전부를 하나의 `AGENTS.md`로 합치고, 각 부분을 `## From <source>` 헤더 아래에 둡니다:

```sh
ai-switch convert cc codex --compile --dry-run
ai-switch convert cc codex --compile --yes
ai-switch convert cc codex --compile --include-local --yes   # CLAUDE.local.md도 포함
```

`@path` 줄은 `<!-- included from … -->` 마커와 함께 인라인됩니다. 기본은 안전합니다: `--include-local` 없이는 `CLAUDE.local.md` 제외; 인라인은 40KB(전체 200KB) 미만의 레포 상대 텍스트 파일(`.md/.txt/.json/.yaml/.yml/.toml`)일 때만. 절대/`~` 경로, 없는 파일, 잘못된 타입, 순환 임포트는 그대로 두고 리포트합니다 — 조용히 버리지 않습니다.

## `handoff`: 안전한 컨텍스트 스캐폴드

`ai-switch handoff`는 다음 에이전트를 위한 독립 `CODEX-HANDOFF.md`를 만듭니다. 원시 채팅·세션·파일 내용은 **절대** 읽지 않습니다 — git에서 파생한 프로젝트 상태와, git이 알 수 없는 인간 컨텍스트용 빈칸만 채웁니다.

```sh
ai-switch handoff                       # CODEX-HANDOFF.md 작성
ai-switch handoff --stdout              # 쓰지 않고 출력
ai-switch handoff --from codex --to cc  # 방향 라벨
```

git에서 자동 채움: 현재 브랜치, 변경 파일(`git status`), diff 요약(`git diff --stat`), 최근 커밋(`git log --oneline`). 빈칸: 목표, 결정, 남은 TODO, 테스트 방법, 알려진 위험, 메모. `--from`/`--to`는 스캐폴드에 라벨만 붙일 뿐 수집하는 git 데이터를 바꾸지 않습니다. 기존 파일은 `--force` 없이 덮어쓰지 않고, `AGENTS.md`는 대상이 될 수 없으며, 절대 경로가 아니라 프로젝트 basename만 기록합니다.

## 범위와 audit

ai-switch는 세 영역을 옮깁니다 — **지시문, MCP 서버, 스킬**. Claude Code엔 더 많은 게 있고(`.claude/agents`, `.claude/commands`, settings의 `hooks`/`permissions`, output styles…) Codex에 1:1 대응이 없습니다. 그런 척하는 대신 `audit`이 찾은 모든 걸 나열하고 분류합니다:

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

모든 마이그레이션 리포트에도 같은 **"Other Claude surfaces detected"** 섹션이 들어가, 실제로 완료되지 않았는데 완료된 것처럼 보이지 않게 합니다.

## 한계

- 자동 MCP 변환은 stdio(`command`/`args`/`env`)와 HTTP(`url`) 서버를 커버합니다; 인증 헤더/bearer 토큰은 수동 설정용으로 표시되고 복사되지 않습니다.
- 원시 채팅 기록과 비공개 세션은 절대 마이그레이션하지 않습니다 — 대신 `handoff`로 안전한 git 기반 스캐폴드를 쓰세요.
- `--global`은 허용목록 전용이며 auth/session/state/log/cache 파일을 건드리지 않습니다.

## 로드맵

- [x] 자격 증명 인벤토리 + 멀티라인 TOML 파싱 (0.2.0)
- [x] 전역 `convert --global`, 허용목록 전용 (0.3.0)
- [x] `.agents/skills` + HTTP MCP `url` 변환 (0.4.0)
- [x] `audit` — 영역을 migrated / manual / not-portable로 분류 (0.5.0)
- [x] `convert --compile` — CLAUDE.md 계층 평탄화 (0.6.0)
- [x] `handoff` — git 기반 컨텍스트 스캐폴드 (0.7.0)
- [ ] Gemini CLI · Cursor 어댑터
- [ ] Codex TOML 작성 시 주석/미지 필드 보존
- [ ] 명시적 위험 경고를 둔 opt-in `--include-env-values`

## 기여

이슈와 PR 환영합니다. 이 프로젝트는 **공개된 동작과 문서화된 파일 포맷만**으로 만들어졌습니다 — 독점·유출·리버스 엔지니어링된 소스는 추가하지 마세요. [CONTRIBUTING.md](CONTRIBUTING.md)와 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
