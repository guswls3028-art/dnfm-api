import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";
import { broadcastQuestionStatuses } from "./schema.js";

export const siteParam = z.object({ site: siteCodeSchema });

export const createQuestionDto = z.object({
  nickname: z.string().trim().min(1).max(32).optional(),
  category: z.string().trim().min(1).max(40).default("general"),
  content: z.string().trim().min(1).max(1000),
  imageR2Key: z.string().trim().max(512).optional(),
});
export type CreateQuestionInput = z.infer<typeof createQuestionDto>;

export const listQuestionsQuery = z.object({
  status: z.enum(broadcastQuestionStatuses).optional(),
  category: z.string().trim().min(1).max(40).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuery>;

export const updateQuestionDto = z.object({
  status: z.enum(broadcastQuestionStatuses).optional(),
  moderationReason: z.string().trim().max(500).optional(),
});
export type UpdateQuestionInput = z.infer<typeof updateQuestionDto>;

export const createDrawSessionDto = z.object({
  title: z.string().trim().min(1).max(160),
  roundNumber: z.number().int().min(1).max(10_000).optional(),
  prize: z.string().trim().max(200).optional(),
  participants: z.array(z.string().trim().min(1).max(80)).min(1).max(500),
  winnerCount: z.number().int().min(1).max(20).default(1),
  note: z.string().trim().max(1000).optional(),
});
export type CreateDrawSessionInput = z.infer<typeof createDrawSessionDto>;

export const listDrawSessionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListDrawSessionsQuery = z.infer<typeof listDrawSessionsQuery>;
