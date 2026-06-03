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
| 스킬 | `.claude/skills/` | `.codex/skills/` |

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

프로젝트 변환은 홈 디렉터리(`~`)가 아니라 실제 저장소/프로젝트 디렉터리에서 실행하세요. 홈 레벨 설정은 현재 읽기 전용으로만 확인할 수 있습니다:

```sh
ai-switch status --global
```

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
| `doctor` | 문제와 경고 진단 |
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
manual-review mcp: linear (HTTP 서버 — stdio command/args/env만 자동 변환됨)
create        .codex/config.toml
copy          .claude/skills -> .codex/skills
report        ai-switch-report.md
```

예제에는 stdio MCP 서버 하나(자동 변환)와 HTTP MCP 서버 하나(수동 검토 표시)를 일부러 넣어, 두 경로를 모두 볼 수 있게 했습니다.

## 안전 모델

`ai-switch`는 기본적으로 보수적입니다:

- 🔍 `--dry-run`은 계획만 출력하고 아무것도 쓰지 않음
- ✋ 쓰기에는 `--yes` 필요
- 🛡️ 기존 파일은 `--force` 없이 **덮어쓰지 않음**
- 💾 모든 쓰기는 `.ai-switch-backups/<timestamp>/`에 스냅샷
- ↩️ `restore latest`는 마이그레이션을 되돌림 — 원본 복원 + 생성된 파일 제거
- 🚫 마이그레이션이 만든 파일을 이후 수정했다면 `--force` 없이는 삭제 거부

`.codex/config.toml`은 덮어쓰기 규칙의 유일한 예외입니다. 마이그레이션은 기존 내용을 보존하고 충돌하지 않는 새 MCP 서버만 추가합니다.

## 지원 매트릭스

| 기능 | cc → codex | codex → cc |
| --- | --- | --- |
| 프로젝트 인스트럭션 | ✅ | ✅ |
| Stdio MCP 서버 | ✅ | ✅ |
| HTTP/SSE MCP 서버 | 📝 수동 검토 | 📝 수동 검토 |
| 로컬 스킬 | ✅ 복사 | ✅ 복사 |
| 중복 MCP 이름 | ⏭️ 건너뜀 | — |
| 계정 / 세션 데이터 | ❌ | ❌ |
| 원격 대화 기록 | ❌ | ❌ |
| 사용자 레벨 글로벌 설정 | 🔎 status만 | 🔎 status만 |

## 변환 매핑

**Claude Code → Codex**
- `CLAUDE.md` → `AGENTS.md`
- `.claude/settings.json#mcpServers` 또는 `.mcp.json#mcpServers` → `.codex/config.toml`
- stdio `command`가 없는 HTTP/SSE 서버 → 수동 검토로 리포트
- `.codex/config.toml`에 이미 있는 MCP 이름 → 건너뜀(중복 TOML 섹션 방지)
- `.claude/skills` → `.codex/skills`

**Codex → Claude Code**
- `AGENTS.md` → `CLAUDE.md`
- `.codex/config.toml`의 MCP 섹션 → `.mcp.json`
- stdio `command`가 없는 Codex 섹션 → 수동 검토로 리포트
- `.codex/skills` → `.claude/skills`

## 자격증명

MCP 서버는 보통 시크릿(API 키, 토큰)이 필요합니다. ai-switch는 **배선** — 서버 이름, command, args, env 변수 *이름* — 만 옮기고, 시크릿 **값**은 도구 간에도 리포트에도 절대 복사하지 않습니다. 마이그레이션 후 `ai-switch-report.md`가 마이그레이션된 서버에 필요한 자격증명 목록을 보여주므로, 같은 환경변수만 새 도구에 설정하면 됩니다. 설정에 박혀 있던 실제 시크릿 값은 (redacted 처리되어) 표시되며, 환경변수로 옮기고 교체하도록 안내합니다.

> ai-switch는 **지속적인 에이전트 인스트럭션과 MCP 배선**을 옮깁니다 — raw 채팅 기록, 비공개 세션, 시크릿 값은 옮기지 않습니다.

## 제한 사항

- 자동 MCP 변환은 stdio 서버(`command`, `args`, `env`)만 지원하며, 원격 HTTP/SSE 서버는 `ai-switch-report.md`에 수동 검토 항목으로 표시됩니다.
- **raw 채팅 기록과 비공개 세션은 절대 옮기지 않습니다** — 코드·시크릿·개인정보가 섞여 있을 수 있고 도구 간에 의미가 통하지 않습니다. 대신 `handoff` 요약 내보내기를 계획 중입니다.
- 글로벌(홈 레벨) 지원은 현재 **읽기 전용** — `status --global`만 가능하며 글로벌 `convert`는 아직 없습니다.

## 로드맵

- ✅ 자격증명 인벤토리 — 마이그레이션된 각 MCP 서버에 필요한 env 변수를 리포트 (0.2.0)
- ✅ 멀티라인 TOML `args`/`env` 파싱 (0.2.0)
- 메모리: 글로벌 인스트럭션/메모리 파일(`~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md`)을 명시적 `--global`에서 마이그레이션
- `handoff` — 다음 에이전트를 위한 간결한 프로젝트 컨텍스트 요약 내보내기 (raw 채팅 아님)
- 옵트인 글로벌 `convert --global` (홈 레벨 설정)
- Gemini CLI, Cursor용 어댑터
- Codex TOML을 쓸 때 주석과 알 수 없는 필드 보존
- 옵트인 `--include-env-values` (시크릿 값 복사, 명시적 위험 경고 뒤에)

## 기여

이슈와 PR 환영합니다. 이 프로젝트는 **공개된 동작과 문서화된 파일 포맷만**을 기반으로 합니다 — 독점·유출·역공학 소스는 추가하지 말아 주세요. [CONTRIBUTING.md](CONTRIBUTING.md)와 [SECURITY.md](SECURITY.md)를 참고하세요.

## 라이선스

[MIT](LICENSE)
