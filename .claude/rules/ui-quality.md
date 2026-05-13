# UI Quality Standards

Always-on UI criteria. Applied to every UI change — not a "mode" to activate.

## Design Goals

- Premium feel with low cognitive load.
- Non-technical users can operate confidently.
- Fast scanning, high-contrast information hierarchy, predictable layouts.
- Consistency across all modules.

## Hierarchy & Layout

- Most important information visible first. Remove noise.
- Strong section headers, stable action bars, clear selected states.
- Comfortable spacing with lightweight but premium cards/panels.
- Separate read mode vs edit mode clearly.
- Sticky context areas where useful. Structured filters/search/sort.

## Operator / Power-User UX

- Primary task must always be obvious. Reduce friction around main workflow.
- Support bulk actions where repetitive work exists.
- Browsing / reading / editing states clearly separated.
- Better filters, presets, log/history visibility.
- Dense screens should feel calm and legible, not cluttered.

## Consistency Rules

- Reuse existing components. No new visual styles without reason.
- Maintain spacing rhythm, color hierarchy, interaction patterns.
- No inconsistent button styles, mismatched tables, different form patterns.

## Design Token SSOT

- 새로운 size / color / spacing 토큰은 디자인 시스템 한 곳에서 정의 후 참조. raw px / hex 인라인 금지.
- Badge / Icon / Button 같은 핵심 컴포넌트는 size enum (xs/sm/md/lg/xl)으로만 노출. raw `size={N}` 금지.
- 컴포넌트마다 다른 사이즈를 같은 의미로 섞어 쓰지 말 것.

## Product-Readiness (상품성)

### Information Hierarchy
- Most important info first. Status (진행중/완료/실패) immediately recognizable.

### CTA Clarity
- Next action is obvious. Button text describes the action exactly.
- Disabled state shows reason.

### State Feedback
- Loading: skeleton/spinner. Success/failure: toast + state change. Empty: guidance text.

### Design System
- Spacing/font/color follow DS tokens.
- Responsive (mobile/tablet) doesn't break.

### Operator Clarity
- No dev terms in user-facing UI. No internal IDs or debug info visible.
- Error messages in user-understandable language.

### Real Data Defaults
- Auto-fill from relational data when it exists. No empty placeholder as final state.
- Editable, but defaults must be reasonable.

## Edge Cases (always check)

- 0 items / 1 item / max items
- Empty selection
- Network error
- Long text overflow
- Concurrent edits

## Narrow Viewport 검증

UI 버튼/라벨/배너 fix 작업 시 **표준 폭(예: 1100 / 1366px) viewport에서 fix 적용 전후 모두 시각 캡처**. grep만으로는 character-level wrap 결함 못 잡음.

- Fix 전 → 캡처 → 코드 fix → Fix 후 → 재캡처 → 효과 검증
- 한국어 텍스트 wrap 영역 `wordBreak: "keep-all"` 기본 검토 (어절 단위)
- inline-flex 버튼은 `whiteSpace: "nowrap"` + `flexShrink: 0` 기본 검토
- 좁은 폭의 좌우 분할 박스는 `flexWrap: "wrap"` + 좌측 `flex: 1, minWidth: 0` 패턴
