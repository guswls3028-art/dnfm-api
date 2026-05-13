# Deployment Credentials SSOT

> 다음 세션 AI 가 "어디 박혀 있는지 / 어디 채우는지" 1초에 알도록 한 파일로 모은 인덱스.
> **값 자체는 절대 기록하지 않음.** 위치·발급처·상태만.
>
> 실시간 EC2 상태 확인 명령 (마스킹 출력):
> ```bash
> ssh -i /tmp/dnfm/ic ec2-user@3.36.42.231 \
>   'awk -F= "/^[A-Z]/ {print \$1\"=<\"(\$2==\"\"?\"empty\":\"set:\"length(\$2)\"chars\")\">\"}" /var/www/dnfm-api/.env'
> ```

## 0. 라이브 운영 인프라 좌표

| 항목 | 값 / 위치 |
|---|---|
| EC2 인스턴스 | `3.36.42.231` (ap-northeast-2, t4g.nano, EBS 16GB) |
| EC2 SSH 키 | `/tmp/dnfm/ic` (로컬 작업머신) |
| EC2 .env | `/var/www/dnfm-api/.env` |
| EC2 PM2 process | `dnfm-api`, `dnfm-newb`, `dnfm-allow` (3개) |
| EC2 Nginx | `/etc/nginx/sites-available/{api,newb,allow}.conf` host 분기 |
| Cloudflare zone | `dnfm.kr` (4 DNS — apex/www/allow/api 모두 proxied orange) |
| R2 버킷 | `dnfm-uploads` |
| GitHub 3 repo | `guswls3028-art/{dnfm,dnfm-allow,dnfm-api}` |
| 로컬 PAT | `c:/academy/.secrets/github-pat.txt` (academy 세션과 공유) |

## 1. 자격증명 현황표 (2026-05-13 EC2 실측)

✅ = EC2 .env 에 주입 완료 / ❌ = empty / 🟡 = 발급은 됐을 가능성, 미확인

| envvar | 상태 | 발급처 | 라이브 의존성 |
|---|---|---|---|
| `DATABASE_URL` (42c) | ✅ | EC2 동거 PostgreSQL 15 | 모든 API |
| `JWT_ACCESS_SECRET` (64c) | ✅ | AI 자체 생성 (crypto.randomBytes(48).toString('base64')) | login/signup |
| `JWT_REFRESH_SECRET` (64c) | ✅ | 동상 | refresh token |
| `R2_ENDPOINT` (65c) | ✅ | Cloudflare R2 dashboard | uploads presign |
| `R2_ACCESS_KEY_ID` (32c) | ✅ | R2 → API Tokens | uploads presign |
| `R2_SECRET_ACCESS_KEY` (64c) | ✅ | 동상 | uploads presign |
| `GEMINI_API_KEY` (39c) | ✅ | aistudio.google.com → Get API Key | 던파 OCR (우선 채널) |
| `GOOGLE_OAUTH_CLIENT_ID` (72c) | ✅ | console.cloud.google.com → APIs & Services → Credentials | /auth/oauth/google/* |
| `GOOGLE_OAUTH_CLIENT_SECRET` (35c) | ✅ | 동상 | /auth/oauth/google/* |
| `GOOGLE_OAUTH_REDIRECT_URI` (46c) | ✅ | `https://api.dnfm.kr/auth/oauth/google/callback` 고정 | |
| `KAKAO_OAUTH_CLIENT_ID` | ❌ | developers.kakao.com → 내 애플리케이션 → REST API 키 | /auth/oauth/kakao/* (현재 비활성) |
| `KAKAO_OAUTH_CLIENT_SECRET` | ❌ | developers.kakao.com → 카카오 로그인 → 보안 → Client Secret 생성 | 동상 |
| `KAKAO_OAUTH_REDIRECT_URI` (45c) | ✅ | `https://api.dnfm.kr/auth/oauth/kakao/callback` 고정 (값은 박혀있지만 client 없어 미동작) | |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | GCP IAM → service account → JSON 다운로드 후 EC2 업로드 | Vision API (GEMINI_API_KEY 로 대체 중 → 발급 불요 가능성) |
| `GOOGLE_VISION_API_KEY` | ❌ | 동상 (위와 양자택일) | 동상 |
| Cloudflare API token | 🟡 | Cloudflare dashboard → My Profile → API Tokens | DNS/Worker 자동화 (이미 한 번 발급됐을 가능성) |
| Cloudflare Origin Certificate | 🟡 미발급 | Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate | SSL Full → Full strict 전환용 (현재 Full) |

## 2. 새로 발급해야 할 자격증명 (사용자 액션 — AI 발급 불가)

### 2.1. Kakao OAuth (현재 비활성. 카카오 로그인 활성화하려면 필수)

발급 절차:
1. https://developers.kakao.com/console/app → 애플리케이션 추가 (이름: `dnfm`)
2. **앱 설정 → 플랫폼 → Web** 등록:
   - `https://dnfm.kr`
   - `https://allow.dnfm.kr`
   - `http://localhost:3000` (newb dev)
   - `http://localhost:3001` (allow dev)
3. **제품 설정 → 카카오 로그인 → 활성화 ON**
4. **Redirect URI 등록**:
   - `https://api.dnfm.kr/auth/oauth/kakao/callback` (운영)
   - `http://localhost:4000/auth/oauth/kakao/callback` (로컬)
5. **동의 항목**: 닉네임 / 프로필사진 / 카카오계정(이메일) — 이메일은 검수 필요할 수 있음
6. **받을 값**:
   - REST API 키 → `KAKAO_OAUTH_CLIENT_ID`
   - 제품 설정 → 카카오 로그인 → 보안 → Client Secret 생성 → `KAKAO_OAUTH_CLIENT_SECRET`

주입 절차 (값 받은 직후):
```bash
ssh -i /tmp/dnfm/ic ec2-user@3.36.42.231
sudo nano /var/www/dnfm-api/.env
# KAKAO_OAUTH_CLIENT_ID=...
# KAKAO_OAUTH_CLIENT_SECRET=...
pm2 restart dnfm-api --update-env
```

### 2.2. Cloudflare Origin Certificate (SSL Full → Full strict)

현재 Cloudflare SSL = Full (origin self-signed OK). Full strict 전환 시:
1. Cloudflare dashboard → 도메인 `dnfm.kr` → SSL/TLS → **Origin Server**
2. **Create Certificate** → Hostnames `*.dnfm.kr, dnfm.kr` → 15년 → ECC 권장
3. 생성된 cert / key 두 파일을 EC2 에 업로드 (`/etc/ssl/cloudflare/origin.pem` / `origin.key`)
4. Nginx server block 의 `ssl_certificate` / `ssl_certificate_key` 경로 교체
5. `sudo nginx -t && sudo systemctl reload nginx`
6. Cloudflare SSL 모드를 **Full (strict)** 로 변경

### 2.3. Vision API (선택 — GEMINI_API_KEY 사용 중이라 보류 가능)

현재 던파 OCR 은 `GEMINI_API_KEY` (Gemini Flash) 로 동작 중. 굳이 Vision 으로 전환할 이유 없으면 발급 보류. 만약 dual-channel 또는 비용/품질 비교가 필요하면:
- console.cloud.google.com → APIs & Services → **Cloud Vision API 활성화**
- IAM → Service Account 생성 → JSON 키 다운로드 → EC2 `/var/www/dnfm-api/secrets/vision-sa.json` 업로드
- `GOOGLE_APPLICATION_CREDENTIALS=/var/www/dnfm-api/secrets/vision-sa.json` 주입

## 3. AI 자체 생성 가능 자격증명

### 3.1. JWT secrets (이미 64chars 박혀있음. 회전 시)

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
# 또는
openssl rand -base64 48
```

회전 절차:
```bash
ssh -i /tmp/dnfm/ic ec2-user@3.36.42.231
sudo nano /var/www/dnfm-api/.env
# JWT_ACCESS_SECRET=<새값>
# JWT_REFRESH_SECRET=<새값>
pm2 restart dnfm-api --update-env
# ⚠️ 회전 즉시 전 사용자 강제 로그아웃 — 운영 시간대 피할 것
```

## 4. 다음 세션 진입 조건 / 즉시 실행 순서

새 Claude 세션 시작 시 이 파일 먼저 읽고 아래 순서로 진행:

### A. Kakao OAuth 자격증명을 받은 경우
1. EC2 `.env` 에 `KAKAO_OAUTH_CLIENT_ID` / `KAKAO_OAUTH_CLIENT_SECRET` 주입
2. `pm2 restart dnfm-api --update-env`
3. 외부 https smoke:
   ```bash
   curl -i 'https://api.dnfm.kr/auth/oauth/kakao/authorize'
   # 302 redirect to kauth.kakao.com 응답이면 성공
   ```
4. 실 브라우저 E2E — newb/allow 로그인 페이지 → 카카오 버튼 → 동의 → 콜백 → 쿠키 발급 → /me 200

### B. 새 기능/버그 fix 사이클 진입한 경우 (자격증명 무관)
1. `cd C:\academy\dnfm\<repo>` (newb / allow / api 중)
2. `git pull` → `pnpm install` → (api 한정) `pnpm db:migrate`
3. `pnpm dev` 로컬 렌더링 확인
4. real-browser E2E — signup → board write → contest entry → admin → vote → results 풀 사이클
5. 캡처 N장 다 Read 후 anti-avoidance §4 양식으로 보고

### C. 자격증명 회전 / 발급 작업만 진행하는 경우
- §2 / §3 의 해당 절차 따라가고 끝.

## 5. 흩어진 기존 자료 인덱스 (찾기 쉽도록)

| 자료 | 위치 | 용도 |
|---|---|---|
| 장애 대응 SOP | `api/docs/incident-response.md` (381줄) | 8 시나리오 + PM2 cheat sheet |
| 던파 직업 매핑 | `api/docs/dnf-classes.md` | OCR → 직업 enum 매핑 표 |
| 이미지 자산 | `api/docs/image-assets.md` | 방장 프사/배너/사이드 자산 좌표 |
| EC2 배포 스크립트 14종 | `C:/academy/_artifacts/dnfm-deploy/` | scp/ssh/nginx/pm2 자동화 |
| Playwright 시각 검수 캡처 44장 | `C:/academy/_artifacts/dnfm-visual/screenshots/20260513-1725/` | 라이브 라우트 회귀 baseline |
| api `.env.example` | `api/.env.example` | envvar 키 리스트 + 주석 |
| newb CLAUDE.md | `newb/CLAUDE.md` | dnfm.kr frontend 룰 |
| allow CLAUDE.md | `allow/CLAUDE.md` | allow.dnfm.kr frontend 룰 |
| api CLAUDE.md | `api/CLAUDE.md` | api.dnfm.kr backend 룰 |

## 6. 절대 금지

- 본 문서에 secret **값** 기록 금지 (위치/길이/마스킹만 OK)
- EC2 `.env` 를 git 에 commit 금지 (`api/.gitignore` 에 `.env` 포함 확인)
- `git add -A` 금지 (academy 정책과 동일 — 실수로 secret 포함 위험)
- AWS CLI 호출 전 `unset AWS_ACCESS_KEY_ID && unset AWS_SECRET_ACCESS_KEY` (R2 키가 IAM 키 덮어쓰는 사고 회피)
- Cloudflare Global API Key 노출 시 즉시 rotate (이전 세션에서 노출된 적 있음 — 사용자 확인 필요)
