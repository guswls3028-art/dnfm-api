# Domain: api (dnfm 공용 백엔드)

`api.dnfm.kr` — newb (`dnfm.kr`) + allow (`allow.dnfm.kr`) 두 frontend 사이트가 공유하는 백엔드. **이 repo (`dnfm-api`) 의 단일 서비스.**

## 1. 본업

두 사이트의 **공통 도메인 코어**:
- 회원 / 인증 (local + Google + Kakao 멀티 provider)
- 사이트별 권한 (`user_site_roles`)
- 게시판 (posts / categories / comments / likes)
- 콘테스트 / 투표 / 결과
- R2 업로드 (presigned URL)
- 알림 / 신고 / 차단 (Stage 후속)

frontend 두 사이트는 **이 서비스만** 콜한다. 사이트끼리 직접 코드 공유 X.

## 2. 사이트 격리 원칙 (절대)

- 모든 사이트별 도메인 데이터는 `site` 컬럼으로 격리 (`posts.site`, `contests.site`, `post_categories.site`).
- 같은 user_id 가 newb 와 allow 양쪽 데이터 보유 가능하나, **다른 사이트의 데이터에 cross 접근 금지** (정책 위반 = `forbidden`).
- API path 자체에 site 분기: `/sites/:site/...`. middleware 가 url param 으로 site 결정.
- 권한 enforcement 는 `user_site_roles` 의 (user, site, role) 기준.
- cross-site endpoint (예: 자매 사이트 카드 1줄용 public summary) 는 별도 `/cross/*` 또는 public read-only 로 명시.

## 3. 인증 모델

세 가지 provider 통합:
- **local** — `user_local_credentials` (username + bcrypt). 회원가입 시 던파 OCR 캡처 3단계 (`basic_info`/`character_list`/`character_select`) 로 모험단명·캐릭터·직업 자동 채움. 2/3 캡처 캐릭터 set 정합 검증 = 본인 인증 (남의 캡처 도용 방지).
- **Google OAuth** — `user_oauth_accounts.provider = "google"`. 같은 email 자동 link 정책 미정.
- **Kakao OAuth** — 동일.

한 user 가 여러 provider 동시 link 가능. JWT (access 짧음 + refresh rotation) + httpOnly 쿠키. 쿠키 도메인 `.dnfm.kr` 로 sibling subdomain (newb / allow / api) 공유.

`user.token_version` 증가 = 강제 logout (비번 변경 시 자동).

## 4. 던파 프로필 (사용자 정책)

- 인식 필드 = **모험단명 + 캐릭터(이름+직업)** 단 3종. 항마력 / 레벨 / 서버는 인식 X (가변·노이즈 큼).
- OCR 캡처 3종 분기:
  1. `basic_info` — 모험단명만
  2. `character_list` — 캐릭 이름들
  3. `character_select` — (이름, 직업) 쌍 + 본인 인증용
- 콘테스트 참가 시 user.dnf_profile 에서 모험단명·캐릭터 자동 prefill.

## 5. 데이터 보호 정책

- 사용자가 작성한 글/댓글/콘테스트 entry/투표는 **AI 자동 변경 영구 금지** (`.claude/rules/anti-avoidance.md §8`).
- 어드민 삭제는 명시적 endpoint + 감사 로그 (audit_logs, Stage 후속).
- migration 기본 = AddField (nullable + default). 사용자 row 의 destructive 변경 X.

## 6. API 표준

- 응답 envelope: `{ data, meta? }` 또는 `{ error: { code, message, details? } }`.
- 에러 코드 = 도메인 별 명시적 string (예: `username_taken`, `invalid_credentials`, `site_required`, `entry_deadline_passed`).
- 모든 요청에 `X-Request-Id` 부여 + 응답 헤더 노출.
- CORS allowlist (env.CORS_ORIGINS). credentials true. 쿠키 도메인 `.dnfm.kr`.
- 모든 destructive endpoint 는 인증 + 권한 검사 필수.

## 7. 관련 파일

- 인프라 / 배포 / 마이그레이션: `docs/deploy-ec2.md` (Stage 1 마지막)
- API 설계 표준: `docs/api-design.md`
- 자매 frontend: 별도 repo `guswls3028-art/dnfm`, `guswls3028-art/dnfm-allow`

## 8. 단계별 로드맵

- **Stage 1 (현재)**: 백엔드 골격 — schema 전체 정의, auth(local) 풀, 다른 도메인 schema placeholder, Hono app + middleware 전부.
- **Stage 2**: posts / comments / likes / categories API 풀. OAuth (google / kakao). 던파 OCR endpoint.
- **Stage 3**: contests / votes / results API. R2 presigned upload. 어드민 endpoints.
- **Stage 4**: 알림 / 신고 / 차단 / 감사 로그.
- **Stage 5**: CI/CD, EC2 배포, Cloudflare proxy. dnfm-api 운영 진입.
