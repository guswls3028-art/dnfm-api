import { z } from "zod";

/**
 * 업로드 목적 enum.
 *   avatar          : 프로필 아바타
 *   dnf_capture     : 던파 모바일 스샷
 *   contest_entry   : 콘테스트 출품작
 *   post_attachment : 게시판 글 첨부
 *   hero_banner     : hero 추천 배너 (admin only)
 */
export const uploadPurposes = [
  "avatar",
  "dnf_capture",
  "contest_entry",
  "post_attachment",
  "hero_banner",
] as const;
export type UploadPurpose = (typeof uploadPurposes)[number];

/** presigned PUT URL 발급 요청. */
export const createPresignedUrlDto = z.object({
  purpose: z.enum(uploadPurposes),
  contentType: z.string().trim().min(1).max(128),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024), // 50MB cap (tentative)
});
export type CreatePresignedUrlInput = z.infer<typeof createPresignedUrlDto>;

/** 업로드 완료 confirm. */
export const confirmUploadDto = z.object({
  // 확장 여지 — 클라가 실제 업로드 후 ETag / sizeBytes 보고 가능 (현재는 빈 객체 허용).
  sizeBytes: z.number().int().min(0).optional(),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadDto>;
