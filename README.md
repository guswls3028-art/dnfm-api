# dnfm-api

`api.dnfm.kr` — dnfm 사이트들의 공용 백엔드 (Hono + Drizzle + PostgreSQL + Cloudflare R2).

newb (`dnfm.kr`) + allow (`allow.dnfm.kr`) 두 frontend 가 이 서비스를 콜한다. frontend repo 와 코드 공유 없음.

## 구조 — 도메인 중심

```
src/
  config/                env, logger
  shared/                Hono app, middleware, db, crypto, errors, types
  domains/
    auth/                회원 / 인증 (local + Google + Kakao + 던파 OCR)
    accounts/            user 설정 / 차단 / 신고 (Stage 후속)
    site_membership/     사이트별 권한 (newb_admin / allow_admin / super)
    posts/               게시판 (디시 던모갤 구조 reference — flair, post_type (normal/notice/BEST/poll), 추천/비추천, 익명)
    comments/            댓글
    likes/               다형 좋아요
    contests/            콘테스트 / 참가 / 투표 / 결과 (allow 메인 기능 + newb 활용 가능)
    uploads/             R2 presigned 업로드 메타데이터
  index.ts               entry — Hono server + graceful shutdown
```

각 domain = `schema.ts` + `dto.ts` + `service.ts` + `routes.ts` + `*.test.ts`.

## 실행

### 사전

- Node 20+, pnpm 9+, Docker (PostgreSQL local)

### 첫 셋업

```bash
pnpm install
cp .env.example .env
# .env 의 JWT_*_SECRET 두 개 채움 (최소 32자)

docker compose up -d        # PostgreSQL 16 (port 5432)
pnpm db:generate            # schema → SQL migration 생성
pnpm db:migrate             # migration 적용
pnpm dev                    # http://localhost:4000
```

### Health check

```bash
curl http://localhost:4000/healthz
curl http://localhost:4000/readyz
```

### Auth (local) smoke

```bash
# signup
curl -X POST http://localhost:4000/auth/signup/local \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"username":"방장쿤","password":"1234","displayName":"방장"}'

# login
curl -X POST http://localhost:4000/auth/login/local \
  -H 'Content-Type: application/json' -c cookies.txt \
  -d '{"username":"방장쿤","password":"1234"}'

# me
curl http://localhost:4000/auth/me -b cookies.txt
```

## 자매 사이트 격리

- frontend (newb / allow) 와 backend (이 repo) 는 **3개 독립 git repo**.
- 두 frontend 가 같은 회원 풀 공유 (.dnfm.kr 쿠키), 그러나 사이트별 데이터는 `site` 컬럼으로 격리.
- cross-site 접근은 super 권한만 우회.

## R2 / CDN

- 사용자 업로드 자산 = Cloudflare R2 (S3 호환, presigned URL).
- 모든 도메인 트래픽 = Cloudflare proxy (orange-cloud). 정적 자산은 Cache rules 로 장기 캐싱.
- S3 / AWS 사용 X.

## Stage 로드맵

- **Stage 1 (현재)**: 백엔드 골격 — schema 전체, auth(local) 풀, middleware, app factory, index.
- **Stage 2**: posts / comments / likes / categories API. OAuth (Google / Kakao). 던파 OCR.
- **Stage 3**: contests / votes / results / R2 uploads.
- **Stage 4**: 알림 / 신고 / 차단 / 감사 로그.
- **Stage 5**: CI/CD + EC2 배포 + Cloudflare DNS 운영 진입.
