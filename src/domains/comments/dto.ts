import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";

/** 댓글 생성. body 1~5000자. */
export const createCommentDto = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type CreateCommentInput = z.infer<typeof createCommentDto>;

/** 댓글 수정. */
export const updateCommentDto = z.object({
  body: z.string().trim().min(1).max(5000),
});
export type UpdateCommentInput = z.infer<typeof updateCommentDto>;

/** 댓글 list 쿼리 — post 별. */
export const listCommentsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListCommentsQuery = z.infer<typeof listCommentsQuery>;

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });
