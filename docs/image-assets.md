# 이미지 자산 spec — 사용자가 만들어 올릴 list

사용자가 디자인 / 캡처 후 frontend repo (dnfm / dnfm-allow) 의 `public/` 아래에 올릴 이미지들의 명세.

이 repo (`dnfm-api`) 는 R2 presigned URL 만 발급. 정적 가이드 이미지 자체는 frontend repo public/ 에서 직접 서빙 (Cloudflare CDN 캐시).

## A. 회원가입 OCR 가이드 이미지 (newb / allow 공통)

사용자가 던파 캡처 3종을 어떤 화면에서 얻는지 시각적으로 안내. 사용자 본인(방장) 의 캡처를 reference 로 사용 OK.

| 파일 | 용도 | 출처 | 크기 권장 |
|------|------|------|-----------|
| `guide-ocr-1-basic-info.jpg` | 1단계: 정보 → 모험단 → 기본정보. 모험단명 표시 화면. | 사용자 본인 캡처 (광기의 파도) | 1080×720, JPG |
| `guide-ocr-2-character-list.jpg` | 2단계: 정보 → 보유캐릭터. 캐릭 카드 그리드. | 사용자 본인 캡처 | 1080×720, JPG |
| `guide-ocr-3-character-select.jpg` | 3단계: 로그인 직후 캐릭터 선택창. 본인인증용. | 사용자 본인 캡처 | 1080×720, JPG |

배치: `dnfm/public/guide/` 또는 `dnfm-allow/public/guide/`.

## B. 직업 아이콘 (newb / allow 공통, 가능하면 동일 자산)

직업 변경 화면 캡처에서 각 아이콘을 crop. baseClass 별로 1개씩.

| 파일명 패턴 | 직업 |
|-----------|------|
| `class/web펀마스터.png` | 웨펀마스터 (귀검사 남) |
| `class/소울브링어.png` | 소울브링어 (귀검사 남) |
| `class/버서커.png` | 버서커 (귀검사 남) |
| `class/아수라.png` | 아수라 (귀검사 남) |
| `class/소드마스터.png` | 소드마스터 (귀검사 여) |
| `class/다크템플러.png` | 다크템플러 (귀검사 여) |
| `class/데몬슬레이어.png` | 데몬슬레이어 (귀검사 여) |
| `class/베가본드.png` | 베가본드 (귀검사 여) |
| `class/블레이드.png` | 블레이드 (귀검사 여) |
| `class/m_스트라이커.png` | 스트라이커 (격투가 남) |
| `class/m_스트리트파이터.png` | 스트리트파이터 (격투가 남) |
| `class/f_넨마스터.png` | 넨마스터 (격투가 여) |
| `class/f_스트라이커.png` | 스트라이커 (격투가 여) |
| `class/f_스트리트파이터.png` | 스트리트파이터 (격투가 여) |
| `class/그래플러.png` | 그래플러 (격투가 여) |
| `class/m_레인저.png` | 레인저 (거너 남) |
| `class/m_런처.png` | 런처 (거너 남) |
| `class/m_메카닉.png` | 메카닉 (거너 남) |
| `class/m_스핏파이어.png` | 스핏파이어 (거너 남) |
| `class/f_레인저.png` | 레인저 (거너 여) |
| `class/f_런처.png` | 런처 (거너 여) |
| `class/f_메카닉.png` | 메카닉 (거너 여) |
| `class/f_스핏파이어.png` | 스핏파이어 (거너 여) |
| `class/빙결사.png` | 빙결사 (마법사 남) |
| `class/스위프트마스터.png` | 스위프트마스터 (마법사 남) |
| `class/엘레멘탈마스터.png` | 엘레멘탈마스터 (마법사 여) |
| `class/마도학자.png` | 마도학자 (마법사 여) |
| `class/배틀메이지.png` | 배틀메이지 (마법사 여) |
| `class/인챈트리스.png` | 인챈트리스 (마법사 여) |
| `class/m_크루세이더.png` | 크루세이더 (프리스트 남) |
| `class/m_인파이터.png` | 인파이터 (프리스트 남) |
| `class/f_크루세이더.png` | 크루세이더 (프리스트 여) |
| `class/이단심판관.png` | 이단심판관 (프리스트 여) |
| `class/무녀.png` | 무녀 (프리스트 여) |
| `class/미스트리스.png` | 미스트리스 (프리스트 여) |
| `class/f_인파이터.png` | 인파이터 (프리스트 여) |
| `class/와일드베인.png` | 와일드베인 (워리어) |
| `class/윈드시어.png` | 윈드시어 (워리어) |

크기: 정사각 128×128 또는 256×256 PNG, 투명 배경 권장. 같은 캐릭이 남/여 별 다른 아이콘이면 `m_` / `f_` prefix.

배치: `dnfm/public/class/`, `dnfm-allow/public/class/` (각 repo 에 동일 자산 복사 — 폴리레포 격리).

## C. newb 사이트 디자인 자산 — 던파 감성

운영자 본인(방장) 의 던파 톤 reference 자산. 사용자 직접 제작/큐레이션.

| 파일 | 용도 |
|------|------|
| `hero/parchment-banner.jpg` | 메인 hero 양피지 배너. 던파 월드맵 톤. |
| `hero/magic-circle.svg` | 마법진 패턴 (장식). gold 계열. |
| `bg/pattern-arad.jpg` | 배경 patten — 아라드 던전 톤. |
| `logo/dnfm-kr.svg` | DNFM.KR 자체 로고 (TM 회피용 자체 브랜드). |
| `icons/scroll.svg`, `quill.svg`, `compass.svg` | 판타지 톤 액션 아이콘 set. |
| `pixel/sprites/*.png` | 픽셀 sprite 캐릭터 (선택 — hero/CTA 장식). |

색상 톤 reference: 자주(#6B2C8E) / 금(#D4A24C) / 양피지(#F4E4B5) / 다크(#1A0F2E). 다음 cycle 의 newb frontend 작업에서 design token SSOT 화.

## D. allow 사이트 디자인 자산 — B급 감성

허락님 페이지. 정돈된 공식 톤과 의도적으로 다름.

| 파일 | 용도 |
|------|------|
| `hero/allow-profile.jpg` | 허락님 프로필 메인 이미지 (사용자 → 허락님 제공) |
| `hero/avatar-contest-banner.jpg` | 아바타 콘테스트 메인 배너 — B급 톤 (사용자 톡방 발췌의 B급 사진 reference) |
| `bg/grunge-texture.jpg` | 거친 질감 배경 |
| `icons/sticker-*.png` | 비대칭 손맛 아이콘 set |

색상 톤: 자유. 허락님 직접 결정. 일단 placeholder.

## E. 공통 시스템 자산 (newb + allow + dnfm-api)

| 파일 | 위치 | 용도 |
|------|------|------|
| `og-image-newb.jpg` | dnfm/public/ | Open Graph 카드 (1200×630) |
| `og-image-allow.jpg` | dnfm-allow/public/ | Open Graph 카드 |
| `favicon-newb.svg` | dnfm/public/ | 파비콘 |
| `favicon-allow.svg` | dnfm-allow/public/ | 파비콘 |
| `placeholder-avatar.svg` | 양쪽 public/ | 회원 기본 아바타 |

## F. R2 동적 자산 (사용자 업로드)

frontend public/ 가 아니라 R2 에 들어가는 자산:
- 회원 프로필 이미지 (`avatar` purpose)
- 던파 OCR 캡처 (`dnf_capture` purpose, 본인인증 검증 후 일정 기간 후 삭제 정책)
- 콘테스트 entry 사진 (`contest_entry` purpose)
- 게시물 첨부 (`post_attachment` purpose)

R2 path 패턴: `<purpose>/<userId>/<uploadId>` — `src/domains/uploads/service.ts` (Stage 3) 가 발급.

## 작업 흐름

1. 사용자 = 자산 제작 / 캡처
2. 사용자 = `dnfm/public/` 또는 `dnfm-allow/public/` 에 push
3. AI = frontend 코드에서 `<img src="/guide/ocr-1-basic-info.jpg" />` 같이 참조
4. Cloudflare proxy = 자동 캐싱 (Cache rules 적용 영역)

자산이 R2 로 가야 하는지 / public/ 으로 가야 하는지 분기:
- 정적 + 모든 사용자가 보는 자산 → public/
- 사용자별 동적 자산 → R2 (presigned URL)
- 빠른 변경 / 운영 중 교체 → R2
