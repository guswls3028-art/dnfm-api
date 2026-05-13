import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";

/** 댓글 생성. body 1~5000자. 회원이면 인증으로, 비회원이면 guest 필드로. */
export const createCommentDto = z.object({
  body: z.string().trim().min(1).max(5000),
  guestNickname: z.string().trim().min(1).max(32).optional(),
  guestPassword: z.string().min(4).max(128).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentDto>;

/** 댓글 수정. 비회원이면 guestPassword 로 본인 검증. */
export const updateCommentDto = z.object({
  body: z.string().trim().min(1).max(5000),
  guestPassword: z.string().min(1).max(128).optional(),
});
export type UpdateCommentInput = z.infer<typeof updateCommentDto>;

/** 댓글 삭제 (비회원 본인 검증용). */
export const deleteCommentDto = z.object({
  guestPassword: z.string().min(1).max(128).optional(),
});
export type DeleteCommentInput = z.infer<typeof deleteCommentDto>;

/** 댓글 list 쿼리 — post 별. */
export const listCommentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuery>;

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });
