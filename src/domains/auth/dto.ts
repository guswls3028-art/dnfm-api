import { z } from "zod";
import { dnfProfileSchema } from "./dnf-profile.js";

/** 자체(local) 가입. username + password + display_name + dnf_profile (선택). */
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
});
export type LocalSignupInput = z.infer<typeof localSignupDto>;

/** 자체 로그인. username + password. */
export const localLoginDto = z.object({
  username: z.string().trim().min(1).max(32),
  password: z.string().min(1).max(128),
});
export type LocalLoginInput = z.infer<typeof localLoginDto>;

/** 비밀번호 변경 — 본인 인증된 상태에서. */
export const changePasswordDto = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(4, "새 비밀번호는 4자 이상이어야 합니다.").max(128),
});
export type ChangePasswordInput = z.infer<typeof changePasswordDto>;

/** 프로필 수정. */
export const updateProfileDto = z.object({
  displayName: z.string().trim().min(1).max(32).optional(),
  dnfProfile: dnfProfileSchema.optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileDto>;
