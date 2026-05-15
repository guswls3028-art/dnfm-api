import { z } from "zod";

/**
 * 던파 모바일 프로필 OCR — 회원가입 인증 (선택)에서 여러 장 캡처 업로드.
 *
 *   1. basic_info        정보 → 모험단 → 기본정보. 모험단명 + 대표 캐릭(이름·직업).
 *                        칭호는 제외, 명패 옆 작은 텍스트가 모험단명.
 *   2. character_list    모험단 → 보유캐릭터. 캐릭 카드 다수. 항마력 수집 X.
 *   3. character_select  로그인 직후 캐릭터 선택. 사칭 불가 신호.
 *
 * 인증 = basic_info.mainCharacterName ∈ character_select 화면 캐릭 이름 (1:1).
 * character_list 는 사칭 가능하므로 캐릭 목록 머지에만 사용 (인증 신호 X).
 */
export const dnfOcrCaptureTypes = ["basic_info", "character_list", "character_select"] as const;
export type DnfOcrCaptureType = (typeof dnfOcrCaptureTypes)[number];

export const dnfOcrCaptureTypeSchema = z.enum(dnfOcrCaptureTypes);

/** OCR 결과 — 각 캡처 타입별로 추출되는 필드. */
export interface DnfOcrResult {
  type: DnfOcrCaptureType;
  /** 모험단명 — basic_info 상단 명패의 작은 텍스트(예: '소비에트연맹'). 큰 글씨는 칭호라 제외. */
  adventurerName?: string;
  /** 대표 캐릭터 이름 — basic_info '대표 캐릭터' 박스 안. */
  mainCharacterName?: string;
  /** 대표 캐릭터 직업명 — basic_info '대표 캐릭터' 박스 안 (dnf-classes 매칭 후 baseClass). */
  mainCharacterClass?: string;
  characterNames?: string[];
  characters?: Array<{ name: string; klass: string }>;
  raw?: string; // 원본 OCR 텍스트 (디버그)
}

/**
 * 인증 판정 — basic_info 의 대표 캐릭 이름이 character_select 화면의 캐릭 이름 목록에
 * 존재하면 true. 공백 정규화 후 1:1 매칭. character_list 는 사칭 가능하므로 인증 신호 X.
 */
export function computeVerified(
  mainCharacterName: string | undefined,
  selectNames: string[] = [],
  _listNamesLegacy?: string[],
): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").trim();
  const target = mainCharacterName ? norm(mainCharacterName) : "";
  if (!target) return false;
  const pool = new Set(selectNames.map(norm).filter(Boolean));
  return pool.has(target);
}

/** DnfProfile dto 검증. */
export const dnfProfileSchema = z.object({
  adventurerName: z.string().trim().min(1).max(32).optional(),
  /** 대표 캐릭터 이름 — basic_info '대표 캐릭터' 박스에서 추출. */
  mainCharacterName: z.string().trim().min(1).max(32).optional(),
  /** 대표 캐릭터 직업명 — basic_info '대표 캐릭터' 박스 (예: 오버마인드, 세라핌). */
  mainCharacterClass: z.string().trim().min(1).max(32).optional(),
  /** 대표 캐릭터 계열 — 동명 직업 disambiguation 용 (예: 거너(여)). */
  mainCharacterClassGroup: z.string().trim().min(1).max(32).optional(),
  characters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(32),
        klass: z.string().trim().min(1).max(32),
        classGroup: z.string().trim().min(1).max(32).optional(),
      }),
    )
    .max(50)
    .optional(),
  verifiedBySelectScreen: z.boolean().optional(),
  captureR2Keys: z
    .object({
      basicInfo: z.string().max(512).optional(),
      characterList: z.string().max(512).optional(),
      characterSelect: z.string().max(512).optional(),
    })
    .optional(),
  ocrSourceR2Key: z.string().max(512).optional(),
  confirmedAt: z.string().datetime().optional(),
});
export type DnfProfileInput = z.infer<typeof dnfProfileSchema>;
