# dnfm-api Project

## A. Project Overview

- **Stack**: Node 20, **Hono v4**, **Drizzle ORM**, **PostgreSQL 16**, **Zod**, **JWT + bcrypt + httpOnly 쿠키**, **Pino**, **Biome**, **Vitest**, **Cloudflare R2 (S3 호환)**.
- **사이트**: `api.dnfm.kr` — newb (`dnfm.kr`) + allow (`allow.dnfm.kr`) 두 frontend 의 공용 백엔드.
- **단일 서비스 / 단일 DB / 단일 인증**. 사이트별 데이터는 `site` 컬럼으로 격리.
- **자매 repo**:
  - `guswls3028-art/dnfm` — newb frontend (`dnfm.kr`)
  - `guswls3028-art/dnfm-hurock` — hurock frontend (`hurock.dnfm.kr`)
- 두 frontend repo 와 코드 공유 없음. fetch 만.
- **현재 버전**: 0.1.0 (Stage 1 — 백엔드 골격).

## B. Workflow

**inspect → schema/migration → service → routes → typecheck → vitest → docker compose up → local smoke → commit → deploy → smoke**
- Do NOT: inspect → ask confirmation → wait. 확인 질문은 failure mode.
- **schema 변경 시**: `pnpm db:generate` → migration 파일 commit + review → `pnpm db:migrate` 로 적용 → 적용 후 정합 검증.
- **E2E**: 격리 환경 (test DB), 모든 endpoint cleanup 필수.

## C. Harness Architecture

```
.claude/rules/ (전부 자동 로딩)
  anti-avoidance.md / core.md / code-quality.md / completion-criteria.md /
  collaboration-policy.md / codex-delegation.md / ui-quality.md
.claude/domains/
  api.md — 본 서비스 도메인 mental model
```

우선순위:
1. 사용자 즉시 지시
2. `anti-avoidance.md`
3. `core.md`
4. 그 외 `.claude/rules/*`
5. `~/.claude/projects/.../memory/`
6. CLAUDE.md
7. 추론

## D. 폴더 구조 — 도메인 중심

```
src/
  config/                env, logger
  shared/                횡단 관심사
    http/
      app.ts             Hono app factory
      response.ts        envelope helper
      middleware/        errors, request-id, cors, auth, site
    db/                  drizzle client, migrate
    crypto/              jwt, password
    storage/             r2 client (Stage 2)
    errors/              AppError
    types/               site / role / etc.
  domains/               도메인 단위 (schema / service / routes / dto / *.test)
    auth/                users, local credentials, OAuth, refresh tokens, 던파 OCR
    accounts/            user 설정 / 차단 / 신고 (Stage 후속)
    site_membership/     user_site_roles
    posts/               게시판 + 카테고리
    comments/            댓글
    likes/               다형 좋아요
    contests/            콘테스트 / 참가 / 투표 / 결과
    uploads/             R2 메타데이터
  index.ts               entry — Hono + graceful shutdown
```

각 domain 안에서:
- `schema.ts` — Drizzle 테이블 정의 (drizzle-kit 이 자동 collect)
- `dto.ts` — Zod 입력 검증
- `service.ts` — 비즈니스 로직 (DB / 외부 API 직접 호출)
- `routes.ts` — Hono router (HTTP 어댑터 — service 호출 + 응답 envelope)
- `*.test.ts` — vitest

domain 간 import 는 schema/types 만. service → service cross-import 는 피하고 필요 시 shared/ 로 추출.

## E. 자매 사이트 격리 정책 (절대)

- frontend 두 repo (`dnfm`, `dnfm-hurock`) 와 코드 공유 X.
- 모든 사이트별 데이터는 `site = "newb" | "allow"` 컬럼으로 격리. cross-site 접근 금지 (super 권한 우회만).
- API path 에 site 명시: `/sites/:site/posts/...`. 사이트 결정은 [[shared/http/middleware/site]] 가 URL param / X-Site-Code 헤더 / Origin 추론으로.

## F. 데이터 보호 정책 (절대)

- 사용자가 작성한 글/댓글/콘테스트/투표는 **AI 자동 변경 영구 금지**.
- migration 기본 모드 = AddField (nullable + default). AlterField / RemoveField / RunPython 으로 사용자 row 변경 X.
- 어드민 삭제는 명시적 endpoint + audit 로그.

## G. 단계별 로드맵

- **Stage 1 (현재)**: 백엔드 골격 — schema 전체, auth(local) 풀, middleware, app factory, index entry.
- **Stage 2**: posts / comments / likes / categories API. OAuth (Google, Kakao). 던파 OCR endpoint.
- **Stage 3**: contests / votes / results / R2 uploads.
- **Stage 4**: 알림 / 신고 / 차단 / 감사 로그.
- **Stage 5**: CI/CD + EC2 배포 + Cloudflare proxy.

---

## 📌 Next Session Entry — 필독 (이 줄을 무시하지 말 것)

**다음 cycle 진입 / 자격증명 / 배포 정보 SSOT** → [`docs/deployment-credentials.md`](docs/deployment-credentials.md)

해당 파일에 정리됨:
- 라이브 인프라 좌표 (EC2 IP / SSH key / .env 경로 / PM2 / Nginx / R2 / Cloudflare zone)
- 자격증명 현황표 (✅ 주입 완료 / ❌ empty / 🟡 미확인) — EC2 `.env` 실측 기준
- 새로 발급해야 할 cred 절차 (Kakao OAuth / Cloudflare Origin Cert / Vision API)
- JWT 회전 snippet
- 다음 세션 진입 조건 A/B/C (Kakao 받음 / 새 기능 / 자격증명 회전)
- 흩어진 자료 인덱스 (incident-response.md / dnf-classes.md / image-assets.md / _artifacts 등)

**관련 SSOT:**
- 장애 대응 → [`docs/incident-response.md`](docs/incident-response.md)
- 던파 직업 매핑 → [`docs/dnf-classes.md`](docs/dnf-classes.md)
- 이미지 자산 → [`docs/image-assets.md`](docs/image-assets.md)
