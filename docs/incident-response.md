# dnfm 장애 대응 가이드

`api.dnfm.kr` + 친구들 frontend (`dnfm.kr` / `allow.dnfm.kr`) 운영 중 발생 가능한 장애 시나리오와 대응 절차.

> 본 문서는 "지금 문제가 났다" 가정으로 즉시 따라할 수 있게 작성.
> 키 값(secret) 자체는 절대 기록하지 않음. **위치 / 명령 / 절차**만 기록.

## 0. 공통 — 가장 먼저 확인

```bash
# 1) 사이트 https 응답 확인
curl -I https://dnfm.kr
curl -I https://allow.dnfm.kr
curl -I https://api.dnfm.kr/healthz   # 또는 /

# 2) EC2 PM2 상태
ssh -i /tmp/dnfm/ic ec2-user@<EC2-IP>
pm2 status
pm2 logs --lines 200
```

응답이 200 + `cf-ray` 헤더가 보이면 Cloudflare edge 는 정상. 502/504 면 origin 문제.
응답 자체가 없으면 Cloudflare 또는 DNS 단계.

### 위치·자격(secret) 인덱스

| 항목 | 위치 |
|---|---|
| EC2 SSH 키 (`ec2-user`) | `/tmp/dnfm/ic` (로컬 작업머신) |
| Cloudflare API token | Cloudflare 대시보드 → My Profile → API Tokens (값 자체는 외부 노출 금지) |
| Wrangler / Cloudflare CLI 인증 | `~/.wrangler/config/default.toml` 또는 `wrangler login` 으로 캐시 |
| API 환경변수 (`DATABASE_URL`, JWT secret, R2 credentials, OAuth secret, GEMINI/Vision keys) | EC2 `/var/www/dnfm-api/.env` |
| PM2 ecosystem | `/var/www/<site>/ecosystem.config.cjs` |
| Nginx server block | `/etc/nginx/sites-available/<site>.conf` |
| 로그 (PM2) | `~/.pm2/logs/<app>-out.log`, `~/.pm2/logs/<app>-error.log` |
| 로그 (nginx) | `/var/log/nginx/access.log`, `/var/log/nginx/error.log` |

> Secret 값을 본 문서에 기록하지 말 것. AWS env가 R2 키로 오염될 수 있는 패턴은 별도 — `unset AWS_ACCESS_KEY_ID && unset AWS_SECRET_ACCESS_KEY` 또는 `aws --profile <name>` 사용.

## 1. PM2 cheat sheet

```bash
# 상태 / 로그
pm2 status                          # 전체 앱 상태
pm2 status dnfm-api                 # 특정 앱
pm2 logs                            # 모든 앱 실시간 로그
pm2 logs dnfm-api --lines 200       # 최근 200줄
pm2 logs dnfm-api --err             # error 로그만
pm2 monit                           # CPU/mem 실시간 대시보드

# 재시작 / 리로드
pm2 restart dnfm-api                # 완전 재시작 (downtime O)
pm2 reload dnfm-api                 # zero-downtime reload (cluster mode 필요)
pm2 restart all
pm2 stop dnfm-api                   # 정지만
pm2 delete dnfm-api                 # 등록 해제

# 영구화 (재부팅 후 자동 시작)
pm2 save                            # 현재 프로세스 목록 저장
pm2 resurrect                       # 저장된 목록으로 복원
pm2 startup systemd                 # systemd 부팅 hook 등록 (출력된 sudo 명령 실행)

# 환경변수 반영 — .env 변경 후엔 restart 가 아니라 `--update-env` 옵션
pm2 restart dnfm-api --update-env

# 메모리 한도 — Next standalone 빌드는 NODE_OPTIONS="--max-old-space-size=512" 권장
```

## 2. 시나리오별 대응

### 2.1 DB 다운 (PostgreSQL 미접속)

**증상**:
- `/auth/me`, `/sites/:site/posts` 등이 500
- PM2 error 로그: `ECONNREFUSED`, `password authentication failed`, `terminating connection due to administrator command`
- API healthcheck (DB ping 포함) 실패

**즉시 대응**:
```bash
# DB 서버 상태 (EC2 동거 또는 RDS)
sudo systemctl status postgresql       # 동거 시
psql "$DATABASE_URL" -c "select 1;"    # 접속 확인 (.env 의 URL)

# PostgreSQL 동거인 경우
sudo systemctl restart postgresql
sudo journalctl -u postgresql -n 200

# 디스크 full 인 경우 (자주 발생) — postgres 가 WAL 쓸 곳 없음
df -h
# /var/lib/postgresql 채워졌으면 → 2.5 EC2 디스크 full 참조

# RDS 인 경우 → AWS 콘솔에서 RDS 인스턴스 상태 확인 + restart
# AWS env 오염 주의:
unset AWS_ACCESS_KEY_ID && unset AWS_SECRET_ACCESS_KEY
aws rds describe-db-instances --region <region>
```

**API 재기동**:
```bash
pm2 restart dnfm-api --update-env
pm2 logs dnfm-api --lines 100
```

**영구 fix**:
- DB connection pool max 가 너무 높지 않은지 확인 (`postgres` driver 의 `max` 옵션).
- `~/.pm2/logs/dnfm-api-error.log` 에 stale connection 패턴 (`connection terminated`) 빈도 측정 → 짧은 idle timeout + reconnect 로직 보강.
- RDS 인 경우 connection storm 대비 RDS Proxy 도입 검토.
- 메모리 부족으로 OOM-killer 가 postgres 죽이는 경우 → `dmesg | grep -i kill` 확인 + 메모리 증설 또는 swap 추가.

### 2.2 Cloudflare proxy 차단 (또는 challenge 폭주)

**증상**:
- 사이트가 갑자기 5xx / 1xxx Cloudflare 에러 화면
- API 호출이 challenge 페이지(HTML)를 받음 — frontend 가 JSON 파싱 실패
- 정상 사용자도 captcha 강제

**즉시 대응**:
1. **Cloudflare 대시보드 → Security → Events** 에서 차단 사유 확인 (rate limit / WAF rule / Bot Fight).
2. **Security Level** 잠시 `Essentially Off` 또는 `Low` 로 (한 zone 단위).
3. **WAF Rules** 에서 최근 추가된 rule 의 `Block` → `Log` 로 토글 (UI: Pause).
4. **Cache Rules** 에 API path 가 잘못 매치되어 캐시되고 있지는 않은지 확인. `api.dnfm.kr/*` 은 bypass 여야 함.

**ssh 우회 확인 (origin 정상 검증)**:
```bash
# Cloudflare 우회해서 origin 직접 — 보안그룹이 본인 IP 만 허용해야 안전
curl -I -H "Host: api.dnfm.kr" http://<EC2-IP>/healthz
curl -I -H "Host: dnfm.kr" http://<EC2-IP>/
```

**영구 fix**:
- API endpoint 는 Cloudflare 의 "Disable Apps" / "Bot Fight Mode" 영향 받음 → `api.dnfm.kr` 은 Bot Fight `Off`, frontend 만 `On`.
- 정상 봇 트래픽이 있는 endpoint(예: presigned upload, OAuth callback)는 별도 path skip 룰.
- Rate limit 룰은 한국 IP 평균 RPS 측정 후 안전 margin.

### 2.3 Cloudflare R2 quota 초과 (또는 PUT 실패)

**증상**:
- 이미지 업로드 (`/uploads/presigned-put` → PUT to R2) 가 403/507
- R2 응답에 `QuotaExceeded`, `SlowDown`, `RequestLimitExceeded`
- Class A operations (PUT/POST/LIST) 가 무료 한도(월 100만)를 넘김

**즉시 대응**:
1. **Cloudflare 대시보드 → R2 → 해당 bucket → Metrics** 에서 quota 사용량 확인.
2. **R2 → Billing** 에서 결제 카드 등록 (paid 자동 전환) — 즉시 정상화 가능.
3. 임시로 업로드 기능을 frontend 에서 disable (글 작성은 본문 only 가능하도록 안내 배너).

**API 쪽 핸들링 확인**:
```bash
# .env 의 R2 access key / secret key / endpoint 정상 여부
pm2 logs dnfm-api | grep -i "r2\|s3\|presign"
```

**영구 fix**:
- 업로드 파일 크기 제한 (예: ≤ 5MB) + content-type allow-list (`image/jpeg`, `image/png`, `image/webp`).
- 클라이언트 측 사전 압축 (already 있으면 quality 조정).
- 일/월 단위 사용량 대시보드 알람 (Cloudflare R2 → Notifications).
- 같은 파일 중복 업로드 dedup (sha256 키 기반).

### 2.4 OAuth provider 다운 (Google / Kakao)

**증상**:
- "Google 로 로그인" / "Kakao 로 로그인" 클릭 시 timeout / 5xx
- `/auth/google/callback`, `/auth/kakao/callback` 에서 500
- `redirect_uri_mismatch` 또는 `invalid_client` 같은 OAuth-specific 에러

**즉시 대응**:
1. Provider 상태 페이지 확인:
   - Google: https://status.cloud.google.com/
   - Kakao: https://devtalk.kakao.com/ (장애 공지 + Twitter)
2. Provider 자체 장애면 **frontend 의 OAuth 버튼 임시 숨김** + "로컬 가입 / 로그인" 강조.
3. 본인 측 설정 문제면:
   ```bash
   # API 환경변수 — Google/Kakao client id/secret 확인
   pm2 env <pm2-id>      # 환경변수 dump (값 노출 — 외부 캡처 금지)
   ```

**redirect_uri 점검**:
- Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 client → "Authorized redirect URIs" 에 `https://api.dnfm.kr/auth/google/callback` 등록 확인
- Kakao Developers → 내 애플리케이션 → 카카오 로그인 → Redirect URI 동일

**영구 fix**:
- OAuth 장애 시 로컬 가입 path 가 살아있도록 분리 유지 ([[domains/auth/routes]]).
- callback 실패 시 사용자에게 명확한 메시지("Google 인증 일시 장애 — 잠시 후 재시도 또는 로컬 로그인 사용").

### 2.5 Gemini API 한도 (OCR 실패)

**증상**:
- 회원가입 던파 프로필 OCR (`/auth/dnf-profile/ocr/...`) 가 429 / 503
- `RESOURCE_EXHAUSTED`, `Quota exceeded for quota metric`

**즉시 대응**:
1. Google Cloud Console → Vertex AI / Generative Language → Quotas 에서 사용량 확인.
2. 일시 차단이면 사용자에게 "OCR 자동 입력 일시 불가 — 수동 입력으로 가입 진행 가능" 안내.
3. frontend `DnfProfileForm.jsx` 의 OCR 실패 fallback (수동 폼) 이 노출되는지 점검.

**API 측 점검**:
```bash
pm2 logs dnfm-api | grep -i "gemini\|vision\|ocr\|quota"
```

**영구 fix**:
- 일일 호출 상한 환경변수 (`GEMINI_DAILY_LIMIT`) + 카운터.
- 사용자별 rate limit (1 회원가입 = OCR 최대 N회).
- 이미지 사전 검증 (해상도 / 파일 크기) — 무의미한 호출 차단.
- 실패 시 무한 재시도 금지 — exponential backoff + 최종 fallback.

### 2.6 PM2 process crash (반복 재시작 / unstable)

**증상**:
- `pm2 status` 의 `restarts` 카운트가 분 단위로 증가
- 사이트 일시 502 → 정상 → 502 반복
- 로그에 stack trace + immediately exit

**즉시 대응**:
```bash
# 어떤 앱이 죽는지
pm2 status

# 마지막 에러
pm2 logs <app> --err --lines 200

# crash 가 너무 빠르면 PM2 가 max_restarts 후 stopped 상태
pm2 describe <app>      # restarts / unstable_restarts 확인

# 1차 시도 — 메모리 부족
free -h
ps aux --sort=-%mem | head

# 메모리 부족이면 standalone 빌드 옵션 + reload
cd /var/www/<site>
NODE_OPTIONS="--max-old-space-size=512" pnpm build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/ 2>/dev/null
pm2 reload <site>
```

**핵심 trace 패턴**:
- `Error: listen EADDRINUSE: address already in use 127.0.0.1:3000` → 같은 포트로 두 번 등록. `pm2 delete <other>` 후 재등록.
- `MODULE_NOT_FOUND` → `pnpm install --frozen-lockfile` 빠짐.
- `Killed` (signal 9) → OOM-killer. `dmesg | tail` 확인.
- `unhandledRejection` 반복 → 코드 root cause 까지 fix 필요.

**영구 fix**:
- `ecosystem.config.cjs` 에 `max_memory_restart: "400M"` 명시.
- `max_restarts: 10` + `min_uptime: "30s"` 로 무한 crash 방어.
- `unhandledRejection` / `uncaughtException` 핸들러 + Pino 로 구조 로그.

### 2.7 EC2 디스크 full

**증상**:
- `pm2 logs` 가 쓰이지 않음
- `pnpm install` / `pnpm build` 가 `ENOSPC`
- PostgreSQL 동거 시 DB write 실패

**즉시 대응**:
```bash
df -h                              # 전체 마운트 상태
du -sh /var/log/* 2>/dev/null | sort -h | tail
du -sh ~/.pm2/logs/*               # PM2 로그 누적
du -sh /var/www/*/node_modules/    # pnpm cache 가 큰 경우

# PM2 로그 flush
pm2 flush                          # 모든 PM2 로그 비움

# 오래된 nginx access 로그 삭제 / rotate
sudo journalctl --vacuum-size=200M
sudo logrotate -f /etc/logrotate.d/nginx

# Next 빌드 cache
rm -rf /var/www/<site>/.next/cache

# Docker 가 동거 중이면
docker system prune -af --volumes  # 주의 — 명시적 진행
```

**영구 fix**:
- PM2 logrotate 모듈 등록: `pm2 install pm2-logrotate` + `pm2 set pm2-logrotate:max_size 10M`.
- EC2 EBS 볼륨 확장 (스냅샷 후 resize2fs).
- 별도 디스크에 로그 마운트.

### 2.8 스팸 봇 대량 가입

**증상**:
- `users` 테이블에 분 단위로 가입 row 증가
- 광고성 글이 게시판에 대량 등록 (특히 `talk` 카테고리)
- 같은 IP / User-Agent 패턴이 `auth_events` 또는 nginx access 로그에 반복

**즉시 대응**:
1. **Cloudflare → Security → WAF** 에서 임시 룰:
   - `Country != KR` AND `URI Path contains "/auth/signup"` → Challenge
   - `Rate limit` 룰: `/auth/signup/local` IP 당 분당 N회
2. **API rate limit 강화** ([[shared/http/middleware/rate-limit]]):
   ```bash
   # .env 에서 회원가입 한도 토글
   AUTH_SIGNUP_RATE_LIMIT_PER_MIN=3
   pm2 restart dnfm-api --update-env
   ```
3. **광고성 글 일괄 처리** — DB 직접 수정은 금지 ([[anti-avoidance.md §8]]). 운영 endpoint 또는 admin UI 의 soft delete 사용:
   ```sql
   -- 검토만 (실행 X — admin UI 통해야 audit 남음)
   SELECT id, title, author_user_id, created_at FROM posts
   WHERE created_at > now() - interval '1 hour'
     AND (title ILIKE '%bit.ly%' OR body ILIKE '%bit.ly%' OR body ILIKE '%t.me/%')
   ORDER BY created_at DESC LIMIT 50;
   ```
4. **신규 가입 일시 차단** 이 필요하면 endpoint 자체 feature flag (env) 로 503.

**영구 fix**:
- 회원가입 시 hCaptcha / Cloudflare Turnstile 통합.
- email verification 필수화 (현재 optional 이면 강제).
- 닉네임 / 본문 정규식 차단 list (광고 키워드).
- `site_membership` 의 일정 활동(글 N개, 가입 D일) 전엔 외부 URL 자동 nofollow + 검수 큐.
- 비밀번호 정책 자체는 학원장 정책 4자 유지하되 ([[domain-policy §8]] 동일 철학) brute force 방어는 throttle + token_version.

## 3. 일반적인 재배포 체크리스트

장애 fix 후 또는 일반 배포 시:

```bash
# 1) Frontend (newb 또는 allow)
ssh -i /tmp/dnfm/ic ec2-user@<EC2-IP>
cd /var/www/<site>                       # dnfm-newb 또는 dnfm-allow
git pull
NODE_OPTIONS="--max-old-space-size=512" pnpm build
cp -r .next/static .next/standalone/.next/
cp -r public .next/standalone/ 2>/dev/null
pm2 reload <site>
pm2 logs <site> --lines 50

# 2) API (dnfm-api)
cd /var/www/dnfm-api
git pull
pnpm install --frozen-lockfile
pnpm build                               # tsc 컴파일
pm2 reload dnfm-api --update-env
pm2 logs dnfm-api --lines 50

# 3) Smoke
curl -I https://dnfm.kr
curl -I https://allow.dnfm.kr
curl -s https://api.dnfm.kr/healthz | head
```

## 4. 사후 처리 (포스트모템)

장애 종료 후:

1. 발생 시각 / 영향 사용자 추정 / 대응 시각을 `_artifacts/incidents/YYYY-MM-DD-<topic>.md` 에 기록.
2. 본 문서의 해당 시나리오 section 을 실제 케이스로 보강 (특히 "영구 fix" 항목).
3. 동일 패턴 재발 방지 코드/룰 추가 (rate limit, alert, monitoring).
4. 사용자 영향 컸으면 공지: 두 frontend 헤더 배너 또는 board 상단 공지 글.

## 5. 안 하면 안 됨 — destructive 명령 가이드

장애 대응 중 흥분해서 destructive 명령 실행하지 말 것 ([[anti-avoidance.md §8]], [[domain-policy §9]]).

**금지** (사용자 데이터 손실 위험):
```bash
# 운영 DB 에 직접 UPDATE/DELETE/TRUNCATE 절대 금지
psql "$DATABASE_URL" -c "DELETE FROM posts WHERE ..."        # ✗
psql "$DATABASE_URL" -c "TRUNCATE comments"                   # ✗
psql "$DATABASE_URL" -c "DROP TABLE ..."                      # ✗

# R2 bucket 통째 삭제 / 비우기
aws s3 rb s3://<bucket> --force                               # ✗
aws s3 rm s3://<bucket>/ --recursive                          # ✗

# git 강제 push to main
git push --force origin main                                  # ✗
```

**허용** (운영 endpoint / admin UI 경유):
- 광고 글 soft delete: admin 권한 user 로 `DELETE /sites/:site/posts/:id`
- 스팸 user ban: admin UI 또는 `user_site_roles` row 추가/수정 (개별)
- 콘테스트 결과 재발행: admin UI `POST /sites/allow/contests/:id/results`

destructive 가 정말 필요하면:
1. 영향 row 수 사전 SELECT 로 확인
2. 백업 (`pg_dump` 또는 R2 객체 복사) 후
3. 사용자(방장) 명시 승인 후
4. 트랜잭션 안에서 실행
