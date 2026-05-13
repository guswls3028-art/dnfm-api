import { z } from "zod";

/**
 * 던파 모바일 프로필 OCR — 회원가입 시 3단계 캡처 업로드.
 *
 *   1. basic_info        정보 → 모험단 → 기본정보 화면.
 *                        추출: 모험단명 (e.g., "광기의 파도")
 *
 *   2. character_list    정보 → 보유캐릭터 화면. 캐릭 카드 N장.
 *                        추출: 캐릭터 이름 배열 (직업은 이 화면에 없음)
 *
 *   3. character_select  로그인 직후 캐릭터 선택 화면. 캐릭 모델 + 이름 + 직업.
 *                        추출: { name, klass } 쌍 배열
 *                        용도: 2번 캡처가 남의 화면을 갖다 붙인 게 아니라는 본인
 *                              인증. 게임 로그인 직후만 볼 수 있는 화면이라
 *                              실제 계정 보유자만 캡처 가능.
 *
 * 검증 정책 — 2번 ∩ 3번 캐릭터 이름 set 의 overlap 비율이 일정 threshold 이상.
 * 통과 시 user.dnf_profile.verifiedBySelectScreen = true.
 *
 * 항마력 / 레벨 / 서버는 인식 X (사용자 정책).
 */
export const dnfOcrCaptureTypes = ["basic_info", "character_list", "character_select"] as const;
export type DnfOcrCaptureType = (typeof dnfOcrCaptureTypes)[number];

export const dnfOcrCaptureTypeSchema = z.enum(dnfOcrCaptureTypes);

/** OCR 결과 — 각 캡처 타입별로 추출되는 필드. */
export interface DnfOcrResult {
  type: DnfOcrCaptureType;
  adventurerName?: string;
  characterNames?: string[];
  characters?: Array<{ name: string; klass: string }>;
  raw?: string; // 원본 OCR 텍스트 (디버그)
}

/** DnfProfile dto 검증. */
export const dnfProfileSchema = z.object({
  adventurerName: z.string().trim().min(1).max(32).optional(),
  characters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(32),
        klass: z.string().trim().min(1).max(32),
      }),
    )
    .max(50)
    .optional(),
  ocrSourceR2Key: z.string().max(512).optional(),
  confirmedAt: z.string().datetime().optional(),
});
export type DnfProfileInput = z.infer<typeof dnfProfileSchema>;
