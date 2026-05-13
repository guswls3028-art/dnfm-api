/**
 * 던파 모바일 직업 매핑 — OCR 결과 정규화.
 *
 * 사용자가 회원가입 시 던파 캡처 (캐릭터 선택창 등) 를 올리면 OCR 이
 * 직업명을 추출한다. 그 직업명은 base / awakening1 / awakening2 중
 * 어느 단계든 나올 수 있다 (캐릭터 각성 진도에 따라).
 *
 * 예: OCR "오버마인드" → normalizeClassName() → 엘레멘탈마스터 (마법사 여, 2차각성)
 *
 * 매핑 출처: 사용자(방장) 직접 검수 매핑. 던파 모바일 기준.
 * 도적/마창사/다크나이트/크리에이터 = 던파 모바일 미출시 (inMobile=false).
 */

export interface DnfClassEntry {
  baseClass: string;
  classGroup: DnfClassGroup;
  awakening1?: string;
  awakening2?: string;
  aliases?: string[];
  inMobile?: boolean;
}

export const DNF_CLASS_GROUPS = [
  "귀검사(남)",
  "귀검사(여)",
  "격투가(남)",
  "격투가(여)",
  "거너(남)",
  "거너(여)",
  "마법사(남)",
  "마법사(여)",
  "프리스트(남)",
  "프리스트(여)",
  "워리어",
  "도적",
  "마창사",
  "다크나이트",
  "크리에이터",
] as const;
export type DnfClassGroup = (typeof DNF_CLASS_GROUPS)[number];

/**
 * 매핑 데이터 — 사용자 방장 직접 검수. ✓ = 사용자 본인 캐릭터로 검증된 매핑.
 *
 * 주의:
 *   - "스톰브링어" 는 마법사(남) 스위프트마스터 1차각성 + 워리어 윈드시어 2차각성
 *     두 곳에 동시 등장. normalizeClassName 매칭 시 첫 entry 가 우선
 *     (UI 에서 group 으로 disambiguate 권장).
 *   - "페월수화" 표기 / "폐월수화" 표기 둘 다 OCR 결과로 가능 — aliases 로 처리.
 */
export const DNF_CLASSES: DnfClassEntry[] = [
  // 귀검사(남)
  { baseClass: "웨펀마스터", classGroup: "귀검사(남)", awakening1: "검성", awakening2: "검신", inMobile: true },
  { baseClass: "버서커", classGroup: "귀검사(남)", awakening1: "헬벤터", awakening2: "블러드 이블", aliases: ["블러드이블"], inMobile: true },
  { baseClass: "소울브링어", classGroup: "귀검사(남)", awakening1: "소울테이커", awakening2: "다크로드", inMobile: true },
  { baseClass: "아수라", classGroup: "귀검사(남)", awakening1: "대암흑천", awakening2: "인다라천", inMobile: true },

  // 귀검사(여)
  { baseClass: "소드마스터", classGroup: "귀검사(여)", awakening1: "노블레스", awakening2: "마제스티", inMobile: true },
  { baseClass: "데몬슬레이어", classGroup: "귀검사(여)", awakening1: "검마", awakening2: "디어사이드", inMobile: true },
  { baseClass: "다크템플러", classGroup: "귀검사(여)", awakening1: "암제", awakening2: "네메시스", inMobile: true },
  { baseClass: "베가본드", classGroup: "귀검사(여)", awakening1: "검호", awakening2: "검제", inMobile: true },
  { baseClass: "블레이드", classGroup: "귀검사(여)", awakening1: "리벨리온", awakening2: "벤데타", inMobile: true }, // ✓ 방장여=벤데타

  // 격투가(남)
  { baseClass: "스트라이커", classGroup: "격투가(남)", awakening1: "패왕", awakening2: "무극", aliases: ["패황"], inMobile: true }, // ✓ 방장남=패황(=패왕)
  { baseClass: "스트리트파이터", classGroup: "격투가(남)", awakening1: "천수나한", awakening2: "명왕", inMobile: true },

  // 격투가(여) — 사용자 본인 다수
  { baseClass: "넨마스터", classGroup: "격투가(여)", awakening1: "백화요란", awakening2: "염제 폐월수화", aliases: ["염제 페월수화", "염제폐월수화", "염제페월수화"], inMobile: true }, // ✓ 조금만기다려, 쪼끔만기다려
  { baseClass: "스트라이커", classGroup: "격투가(여)", awakening1: "챔피언", awakening2: "카이저", inMobile: true }, // ✓ 도움핑, 그랩폿
  { baseClass: "스트리트파이터", classGroup: "격투가(여)", awakening1: "독왕", awakening2: "용독문주", inMobile: true }, // ✓ 여스파링
  { baseClass: "그래플러", classGroup: "격투가(여)", awakening1: "토네이도", awakening2: "얼티밋 디바", aliases: ["얼티밋디바"], inMobile: true },

  // 거너(남)
  { baseClass: "레인저", classGroup: "거너(남)", awakening1: "데스페라도", awakening2: "레이븐", inMobile: true }, // ✓ 점심밥무뇽=레이븐
  { baseClass: "런처", classGroup: "거너(남)", awakening1: "블래스터", awakening2: "디스트로이어", inMobile: true },
  { baseClass: "메카닉", classGroup: "거너(남)", awakening1: "마이스터", awakening2: "프라임", inMobile: true },
  { baseClass: "스핏파이어", classGroup: "거너(남)", awakening1: "제너럴", awakening2: "커맨더", inMobile: true },

  // 거너(여)
  { baseClass: "레인저", classGroup: "거너(여)", awakening1: "블러디아", awakening2: "크림슨 로제", aliases: ["크림슨로제"], inMobile: true },
  { baseClass: "런처", classGroup: "거너(여)", awakening1: "헤비배럴", awakening2: "스톰트루퍼", inMobile: true },
  { baseClass: "메카닉", classGroup: "거너(여)", awakening1: "메탈하트", awakening2: "옵티머스", inMobile: true }, // ✓ 천천히가요=옵티머스
  { baseClass: "스핏파이어", classGroup: "거너(여)", awakening1: "발키리", awakening2: "프레이야", inMobile: true },

  // 마법사(남)
  { baseClass: "빙결사", classGroup: "마법사(남)", awakening1: "프로즌하트", awakening2: "이터널", inMobile: true },
  { baseClass: "스위프트마스터", classGroup: "마법사(남)", awakening1: "스톰브링어", awakening2: "아이올로스", inMobile: true },

  // 마법사(여) — 사용자 본인 다수
  { baseClass: "엘레멘탈마스터", classGroup: "마법사(여)", awakening1: "아크메이지", awakening2: "오버마인드", inMobile: true }, // ✓ 지금간다=오버마인드
  { baseClass: "마도학자", classGroup: "마법사(여)", awakening1: "트릭스터", awakening2: "지니위즈", inMobile: true },
  { baseClass: "배틀메이지", classGroup: "마법사(여)", awakening1: "벨라트릭스", awakening2: "아슈타르테", inMobile: true }, // ✓ 나도딜러야=아슈타르테
  { baseClass: "인챈트리스", classGroup: "마법사(여)", awakening1: "블랙 메이든", awakening2: "헤카테", aliases: ["블랙메이든"], inMobile: true }, // ✓ 무뇽인챈=헤카테

  // 프리스트(남)
  { baseClass: "크루세이더", classGroup: "프리스트(남)", awakening1: "홀리오더", awakening2: "세인트", inMobile: true }, // ✓ 힐게e=세인트
  { baseClass: "인파이터", classGroup: "프리스트(남)", awakening1: "갓핸드", awakening2: "저스티스", inMobile: true },

  // 프리스트(여)
  { baseClass: "크루세이더", classGroup: "프리스트(여)", awakening1: "에반젤리스트", awakening2: "세라핌", inMobile: true }, // ✓ 지금가요/금방가요/성심당누나/파저리=세라핌
  { baseClass: "이단심판관", classGroup: "프리스트(여)", awakening1: "헬카이트", awakening2: "인페르노", inMobile: true }, // ✓ 불도녀=인페르노
  { baseClass: "무녀", classGroup: "프리스트(여)", awakening1: "신녀", awakening2: "천선낭랑", inMobile: true }, // ✓ 무뇽이귀여워=천선낭랑
  { baseClass: "미스트리스", classGroup: "프리스트(여)", awakening1: "신세이어", awakening2: "리디머", inMobile: true },
  // 여인파이터 — AI 기존 매핑 유지 (사용자 정정: "니 매핑이 맞음")
  { baseClass: "인파이터", classGroup: "프리스트(여)", awakening1: "성령기사", awakening2: "그랜드마스터", aliases: ["그랜드 마스터"], inMobile: true },

  // 워리어 (던파 모바일 전용 캐릭터)
  { baseClass: "와일드베인", classGroup: "워리어", awakening1: "와일드하트", awakening2: "인레이지", inMobile: true },
  { baseClass: "윈드시어", classGroup: "워리어", awakening1: "가일윈드", awakening2: "스톰브링어", inMobile: true },

  // 도적 — 던파 모바일 미출시 (PC 전용)
  { baseClass: "로그", classGroup: "도적", awakening1: "섀도우댄서", awakening2: "팬텀 어쌔신", inMobile: false },
  { baseClass: "쿠노이치", classGroup: "도적", awakening1: "사신", awakening2: "쉬바", inMobile: false },

  // 마창사 — 던파 모바일 미출시
  { baseClass: "뱅가드", classGroup: "마창사", awakening1: "듀얼리스트", awakening2: "워로드", inMobile: false },
  { baseClass: "다크 랜서", classGroup: "마창사", awakening1: "다크 디센더", awakening2: "스톰 브링어", inMobile: false },

  // 다크나이트 — PC 전용
  { baseClass: "다크나이트", classGroup: "다크나이트", awakening1: "다크나이트", awakening2: "심연의 회랑", inMobile: false },

  // 크리에이터 — PC 전용
  { baseClass: "크리에이터", classGroup: "크리에이터", awakening1: "크리에이터", awakening2: "패러독스", inMobile: false },
];

/**
 * OCR 결과 텍스트 → 정규화된 직업 정보.
 * base / awakening1 / awakening2 / aliases 어떤 표기로 들어와도 같은 entry 반환.
 *
 * 매칭 규칙:
 *   1. 공백/특수문자 제거 후 비교
 *   2. exact match → 부분일치 fallback (3자 이상)
 *   3. 못 찾으면 null
 *
 * 모호한 경우 (예: "스톰브링어" — 스위프트마스터 또는 윈드시어) 는
 * 배열 순서상 먼저 등장하는 entry. caller 가 classGroup 으로 disambiguate.
 */
export function normalizeClassName(ocrText: string): DnfClassEntry | null {
  const norm = ocrText.replace(/[\s·]/g, "").trim();
  if (!norm) return null;

  for (const entry of DNF_CLASSES) {
    const candidates = [
      entry.baseClass,
      entry.awakening1,
      entry.awakening2,
      ...(entry.aliases ?? []),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      if (c.replace(/[\s·]/g, "") === norm) return entry;
    }
  }

  for (const entry of DNF_CLASSES) {
    const candidates = [
      entry.baseClass,
      entry.awakening1,
      entry.awakening2,
      ...(entry.aliases ?? []),
    ].filter(Boolean) as string[];
    for (const c of candidates) {
      const cn = c.replace(/[\s·]/g, "");
      if (cn.length >= 3 && (norm.includes(cn) || cn.includes(norm))) return entry;
    }
  }

  return null;
}

/** 직업 group 별 묶음 — UI select 의 group header 용. inMobile=false 는 제외. */
export function listClassesByGroup(): Array<{ group: DnfClassGroup; classes: DnfClassEntry[] }> {
  const map = new Map<DnfClassGroup, DnfClassEntry[]>();
  for (const entry of DNF_CLASSES) {
    if (entry.inMobile === false) continue;
    if (!map.has(entry.classGroup)) map.set(entry.classGroup, []);
    map.get(entry.classGroup)!.push(entry);
  }
  return [...map.entries()].map(([group, classes]) => ({ group, classes }));
}
