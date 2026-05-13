# Completion Criteria

Two requirements. Both must be met:
1. **No bugs.** Zero known defects in scope. Edge cases handled. Works in production.
2. **UI/UX is polished.** User needs zero explanation to use it.

## E2E Validation Standard

E2E = real browser + DOM visible assertion. API calls alone are NOT E2E.

**Required flow:**
- Real UI click → form input → save → reopen/reload → state persisted → related screens reflect change
- Navigate via sidebar/buttons (real user path). Direct URL goto = initial entry only (login/dashboard).
- Role-based: action → other roles see result without contradiction (where applicable).
- State transitions: create → progress → complete full flow. Correct UI at each state. Data consistency after.

**Download validation:**
- File exists, correct type/header (PDF = `%PDF-`), content reflects selected data, works on production URL.

**Test data:** 격리된 테스트 환경 또는 명시적 테스트 데이터셋만. `[E2E-{timestamp}]` 또는 동등 태그 + cleanup 필수.

## Forbidden Completion Patterns

Never report completion if any of these are true:
- Button exists but user cannot actually use the result
- Download opens HTML/login page instead of intended file
- Real data exists but defaults are empty
- Requested edge cases not verified
- Works locally only, not in production
- Workaround created instead of fixing the real product path
- Output format wrong (HTML labeled as PDF, etc.)
- Build passes but page doesn't actually render correctly

## Verification Reporting

3-split:
1. **UI / E2E** — what was clicked, what was seen, screenshots (캡처 N장 찍었으면 N장 다 Read 후 보고. 일부만 본 경우 정직히 표기 — [[anti-avoidance.md §4]])
2. **API integration** — endpoints called, response shapes verified
3. **Shell/data state** — data state confirmed, migrations applied

No empty sections. If not verified, omit — don't write "N/A".

**금지 보고 표현** (위반 시 검증 실패로 간주):
- "즉시 사용 가능 / 운영 가능 / 만족도 N점"
- "처리 N건 PASS / 정확도 N%" (메트릭 카운터는 검증 아님)
- "시각 검증 완료" — 캡처를 다 Read하지 않고 보고 시 위반

## Verification Fail — 3-tier Default Behavior

E2E spec / build / deploy 검증 fail 시 다음 순서로 자기 시도:

**1차 fail** → 진입 path / 데이터 ID / API 응답 형태 사전 조회 후 spec fix → 재시도.
**2차 fail** → 환경 가정 재점검. fixture / mock / 다른 데이터셋으로 재시도. 디버깅 시 추측 금지, 실제 상태 dump ([[anti-avoidance.md §5]]).
**3차 fail** → 사용자 의향 확인 가능. **응답에 반드시 명시**:
- 1·2차 시도 sequence + 실패 이유 (file_path:line 수준)
- 자기 시도로 fix 불가 사유 (환경 블로커 / 데이터 접근 제약 등)
- 사용자가 정확히 해야 할 일 (구체적 단계 — "1분 클릭" 같은 모호 X)

**금지**: 1차 fail 직후 사용자 떠넘김. "사용자가 1분이면 끝" 합리화는 [[anti-avoidance.md §2]] 위반.

## Delivery Loop

self-review → typecheck/build/tests → UI/E2E (캡처 N장 + N장 다 Read) → deploy → post-deploy smoke → **repeat until pass**

각 단계 fail 시 위 "Verification Fail — 3-tier Default Behavior" 적용.
