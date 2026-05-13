# Code Quality Standards

Always-on quality criteria. Applied to every code change — not a "mode" to activate.

## Architecture

- Business logic must not leak into UI layers.
- Domain logic must not depend on presentation layers.
- Shared utilities must remain generic.
- No circular imports, hidden side effects, global mutable state, tight cross-domain coupling.
- Dependency direction: domain → service → presentation. Never reverse.
- When changing multiple files: check domain boundaries, module cohesion, dependency direction.

## Debugging

- Identify symptom precisely → trace call path + data flow → locate root cause → smallest correct fix.
- No guessing. Code evidence only — stack traces, actual data shape, state transitions.
- When fixing a bug, search for the same pattern in related code (eliminate the bug CLASS, not just the instance).
- Prefer deterministic fixes over workaround logic. Cosmetic fixes that hide real issues = forbidden.
- 추측 전 실제 상태 dump 우선 ([[anti-avoidance.md §5]]). 2회 연속 실패 → 멈춤 + 재추적.

## Refactoring

- Map dependency surface first. Define behavior-preserving scope. Apply incrementally.
- Keep interfaces stable unless change is explicitly required.
- Preferred: extract helpers/hooks/components, normalize naming, remove dead code, reduce duplication.
- Stop if: refactor requires broad architectural migration, or test surface is too weak for confidence.

## Performance

- Optimize real bottlenecks, not imagined ones. Profile before optimizing.
- Categories: network / rendering / state churn / expensive computation / repeated fetching / large DOM.
- Preferred: memoization, list virtualization, debounce, component splitting, redundant fetch removal, lazy loading.
- No speculative micro-optimizations. No unsafe caching.

## Hardening (correctness-critical work)

- Bug fixes must eliminate the bug CLASS: trace related code paths, check surrounding logic, verify frontend/backend contract, strengthen validation.
- Fix order: permission/auth → data integrity → race conditions → validation gaps → UX safety.
- System must be resilient to: repeated clicks, invalid data, wrong-order actions, concurrent operations, partial failures.
- State transitions, aggregation/settlement logic, optimistic UI rollback = high-risk audit targets.

## Domain Closure

For each domain, verify when stabilizing:
- spec vs implementation consistency
- state transitions + business rules
- API/frontend contract match
- role/permission behavior
- edge cases (0, 1, max, empty, error)
- loading/error/empty states
- retry/concurrency safety
