import { z } from "zod";
import { dnfProfileSchema } from "./dnf-profile.js";

/** 자체(local) 가입. username + password + display_name + dnf_profile (선택).
 *  characterListNames / characterSelectNames / captureR2Keys 가 함께 오면
 *  signup 안에서 verifiedBySelectScreen 까지 계산해 atomic 하게 박는다.
 */
export const localSignupDto = z.object({
  username: z
    .string()
    .trim()
    .min(3, "아이디는 3자 이상이어야 합니다.")
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, "영문/숫자/언더스코어만 사용할 수 있습니다."),
  password: z.string().min(4, "비밀번호는 4자 이상이어야 합니다.").max(128),
  displayName: z.string().trim().min(1).max(32),
  dnfProfile: dnfProfileSchema.optional(),
  characterListNames: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
  characterSelectNames: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
  captureR2Keys: z
    .object({
      basicInfo: z.string().max(512).optional(),
      characterList: z.string().max(512).optional(),
      characterSelect: z.string().max(512).optional(),
    })
    .optional(),
  rememberMe: z.boolean().optional().default(true),
  // 약관/개인정보처리방침 동의 — 필수.
  // 본문 변경 시 server-side 검증으로 새 가입자는 강제 동의시킴.
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "약관 및 개인정보처리방침에 동의해 주세요." }),
  }),
});
export type LocalSignupInput = z.infer<typeof localSignupDto>;

/** 자체 로그인. username + password. */
export const localLoginDto = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
  rememberMe: z.boolean().optional().default(true),
});
export type LocalLoginInput = z.infer<typeof localLoginDto>;

/** 비밀번호 변경 — 본인 인증된 상태에서. */
export const changePasswordDto = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(4, "새 비밀번호는 4자 이상이어야 합니다.").max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordDto>;

/**
 * 시청 플랫폼 enum — hurock 사이트 가입자만 입력.
 *   youtube — 유튜브 / soop — 숲(아프리카TV) / chzzk — 치지직 / null — 미설정.
 */
export const viewerPlatforms = ["youtube", "soop", "chzzk"] as const;
export const viewerPlatformSchema = z.enum(viewerPlatforms);
export type ViewerPlatform = (typeof viewerPlatforms)[number];

/** 프로필 수정. */
export const updateProfileDto = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  // R2 key (avatars/<uuid>.jpg 등). null = 아바타 제거.
  avatarR2Key: z.string().max(512).nullable().optional(),
  dnfProfile: dnfProfileSchema.optional(),
  viewerPlatform: viewerPlatformSchema.nullable().optional(),
  viewerNickname: z.string().trim().min(1).max(32).nullable().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileDto>;

/** 회원 탈퇴 — 본인 비밀번호 재확인 필요 (자체 가입자). OAuth-only 계정은 password 생략. */
export const deleteAccountDto = z.object({
  password: z.string().min(1).max(128).optional(),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountDto>;

/** super 권한 — 자체 가입자 비밀번호 reset. username 으로 식별. 임시 비번 리턴. */
export const adminResetPasswordDto = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
});
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordDto>;
