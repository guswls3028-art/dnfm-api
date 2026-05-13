import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";

/**
 * 좋아요 대상 enum.
 *   post / comment / contest_entry — 추후 도메인 추가 시 확장.
 */
export const likeTargetTypes = ["post", "comment", "contest_entry"] as const;
export type LikeTargetType = (typeof likeTargetTypes)[number];

/** 좋아요 토글. */
export const likeDto = z.object({
  targetType: z.enum(likeTargetTypes),
  targetId: z.string().uuid(),
});
export type LikeInput = z.infer<typeof likeDto>;

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });
