# Codex Delegation — 토큰 효율 분배

Claude Opus 는 판단/정합/안전 책임이 큰 작업에 쓰고, 단순 enumeration / 패턴 작업은 `mcp__codex__codex` 로 위임해 토큰을 분배한다. Claude 가 "전부 직접" 하면 컨텍스트가 빨리 차고, 정작 중요한 판단 단계에서 압축·재요약 비용이 발생한다.

## 0. 핵심 원칙

- Claude = 책임자(판단/검증/병합), Codex = 보조 일꾼(생성/열거/draft).
- Codex 출력은 **항상 draft**. Claude 가 diff 를 읽고 검증·수정 후에만 commit.
- Codex 에게 판단을 떠넘기지 X. Codex prompt 에 "분석하고 결정해줘" 금지 — "정확히 X 를 출력해줘" 만.

## 1. Codex 위임 적합 (저비용 토큰 우선)

다음 작업은 Codex 1차 → Claude 검수 패턴.

- **대량 enumeration / audit**: 파일 전수 스캔, 패턴 매치 보고서, dead code 후보 리스트
- **mechanical refactor**: rename, format 통일, 동일 패턴 mass replace
- **boilerplate / scaffolding**: CRUD 컴포넌트 골격, 타입 정의 더미, fixture 생성
- **문서 draft**: README 초안, 변경 로그 초안, 주석 일괄 추가 (Claude 가 톤 수정)
- **테스트 골격**: 케이스 enumeration, 입력/예상값 테이블 (assertion 디테일은 Claude)
- **번역/표현 베리에이션**: 동일 의미의 다른 wording N개 생성
- **long-context 탐색**: 큰 파일/문서를 요약·발췌해 Claude 에게 핵심만 전달

## 2. Codex 위임 금지 (Claude 직접)

다음은 토큰 비싸도 Claude 가 직접. Codex 결과를 "그대로 통과" 시키면 정합 실패.

- **아키텍처 결정** (도메인 경계, 의존 방향, 모듈 분리)
- **보안 / 권한 / tenant 격리** 로직 — 위반 시 [[core.md §1]]
- **버그 root cause 분석** — Codex 가 추측 fix 제안해도 무시. [[anti-avoidance.md §5]] 위반
- **E2E / 시각 검증 해석** — 캡처 N장 Read 책임은 Claude 본인 ([[anti-avoidance.md §4]])
- **사용자 데이터 변경 로직** — destructive SQL/migration, manual=true 보호 등 [[anti-avoidance.md §8]]
- **정책 결정** — 가격/환불/UI 진입점 등 — 사용자 본인에게 확인
- **회피 합리화 판정** — Codex 에게 "이 fix 가 회피인지" 물어보기 X. Claude 본인 자기인식.

## 3. Codex prompt 작성 규칙

Codex 는 이 대화의 컨텍스트를 모름. prompt 는 self-contained 로 작성.

**포함 필수:**
- 목표 (한 문장)
- 입력 파일 절대 경로 / 코드 snippet (직접 첨부)
- 제약 (스타일, 금지 패턴, 출력 형식)
- 출력 형식 (markdown 표 / JSON / unified diff / 코드 블록 — 명시)
- 길이 상한 ("under 300 words" 등)

**포함 금지:**
- "판단해서 알아서 해줘" 류 모호 지시
- 이 대화의 기존 결정·맥락 전제 ("아까 우리가 합의한 대로...")
- Claude 의 시도 실패 이력 (Codex 가 같은 함정 빠질 확률 ↑)

**예시 prompt 골격:**
```
[목표] dnfm/src/content.js 의 모든 외부 링크 목록을 markdown 표로 추출.
[입력] {file_path 그대로}
[출력] | label | url | section | active_flag | 4열 표. url=null 인 항목 포함.
[제약] 표 외 텍스트 금지. 300 단어 이하.
```

## 4. 검증 — Codex 결과 통과 기준

Codex 응답을 받으면:

1. **출력 형식 일치** 확인 — 어긋나면 재요청 또는 폐기 (Claude 가 재작성하는 게 빠를 때 많음)
2. **사실 검증** — 파일 경로/식별자/숫자 등은 Claude 가 직접 Read/Grep 으로 재확인. Codex hallucination 가능
3. **회피 트랩 확인** — Codex 가 "주석 처리 / try-except 으로 덮기 / 테스트 spec 수정으로 통과" 같은 우회 제안하면 거부. [[anti-avoidance.md §5]]
4. **diff 가 작은가** — 의도보다 광범위한 수정이면 scope 잘라 재요청

검증 실패 시 [[completion-criteria.md]] "3-tier" 적용: Codex 재시도 1회 → 직접 작성 → 사용자 보고.

## 5. 비용/효율 판단 기준

다음 경우 Codex 위임 가치 큼:

- 작업이 **반복적 + 검증이 쉬움** (출력이 표/리스트라서 한 눈에 검수 가능)
- Claude 가 직접 하면 **컨텍스트가 N천 토큰 증가** (큰 파일 enumeration)
- 결과의 **정밀도가 ±10% 허용** (draft 단계)

다음 경우 Claude 직접이 낫다:

- 작업이 **1~2 파일, 수 줄 수정** — prompt 작성 + 검증 overhead 가 본 작업보다 큼
- **컨텍스트가 critical** — 이 대화의 결정·합의에 강하게 의존
- **실패 cost 큼** — prod 데이터, 보안, 정책

## 6. 관련 메모리

- [[feedback_codex_delegation]] — Codex 위임 패턴 학습 이력
- [[core.md §6]] — 모델별 토큰 효율 표 (haiku/sonnet/opus 분배)
