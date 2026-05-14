import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";
import { reportReasons, reportStatuses, reportTargetTypes } from "./schema.js";

/** 신고 접수 — 회원/비회원 모두. */
export const createReportDto = z.object({
  targetType: z.enum(reportTargetTypes),
  targetId: z.string().uuid(),
  reason: z.enum(reportReasons),
  detail: z.string().trim().max(2000).optional(),
});
export type CreateReportInput = z.infer<typeof createReportDto>;

/** 신고 목록 (어드민). */
export const listReportsQuery = z.object({
  status: z.enum(reportStatuses).optional(),
  targetType: z.enum(reportTargetTypes).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListReportsQuery = z.infer<typeof listReportsQuery>;

/** 처리 — 어드민. status 변경 + 조치 메모. */
export const updateReportDto = z.object({
  status: z.enum(reportStatuses),
  resolution: z.string().trim().max(64).optional(),
  resolutionNote: z.string().trim().max(2000).optional(),
  moderatorMemo: z.string().trim().max(2000).optional(),
});
export type UpdateReportInput = z.infer<typeof updateReportDto>;

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });
