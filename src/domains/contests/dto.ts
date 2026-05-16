import { z } from "zod";
import { siteCodeSchema } from "../../shared/types/site.js";
import { contestEntryStatuses, contestStatuses } from "./schema.js";

/**
 * 콘테스트 dto — 어드민 작성용 / 회원 참가용 / 투표 / 결과.
 *
 * form_schema 는 자유 JSON. 어드민이 사이트별로 양식 필드 정의.
 *   예: { fields: [{ name: "adventurer_name", required: true, prefill: "dnf" }, ...] }
 *
 * 사용자(콘테스트 entry / vote / result)가 작성한 데이터는 어떤 path 로도
 * 자동 변경되지 않음. 모든 PATCH 는 명시적 admin 액션.
 */

/** site param. */
export const siteParam = z.object({ site: siteCodeSchema });

/** 콘테스트 생성 (admin). */
export const createContestDto = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(10_000).optional(),
  formSchema: z.record(z.string(), z.unknown()).default({}),
  maxEntries: z.number().int().min(0).default(0),
  entryDeadlineAt: z.string().datetime().optional(),
  voteStartAt: z.string().datetime().optional(),
  voteEndAt: z.string().datetime().optional(),
  coverR2Key: z.string().max(512).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(contestStatuses).default("draft"),
});
export type CreateContestInput = z.infer<typeof createContestDto>;

/** 콘테스트 수정 (admin). */
export const updateContestDto = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(10_000).optional().nullable(),
  formSchema: z.record(z.string(), z.unknown()).optional(),
  maxEntries: z.number().int().min(0).optional(),
  entryDeadlineAt: z.string().datetime().optional().nullable(),
  voteStartAt: z.string().datetime().optional().nullable(),
  voteEndAt: z.string().datetime().optional().nullable(),
  coverR2Key: z.string().max(512).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(contestStatuses).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type UpdateContestInput = z.infer<typeof updateContestDto>;

/** 콘테스트 list 쿼리. */
export const listContestsQuery = z.object({
  status: z.enum(contestStatuses).optional(),
  sort: z.enum(["recent", "popular"]).default("recent"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
export type ListContestsQuery = z.infer<typeof listContestsQuery>;

/**
 * entry 생성. 상품/이미지 업로드 이벤트라 로그인 회원만 참가 가능하다.
 * 정책 SSOT: project_anonymous_posting_policy.md (2026-05-14).
 */
export const createEntryDto = z.object({
  fields: z.record(z.string(), z.unknown()).default({}),
  imageR2Keys: z.array(z.string().max(512)).max(20).default([]),
  // 과거 비회원 참가 클라이언트가 보내도 무시된다. route 에서 requireAuth.
  guestNickname: z.string().trim().min(1).max(32).optional(),
  guestPassword: z.string().min(4).max(128).optional(),
});
export type CreateEntryInput = z.infer<typeof createEntryDto>;

/** entry 삭제 — 비회원이면 guestPassword 본인 검증. 어드민은 무조건 통과 (route 단). */
export const deleteEntryDto = z.object({
  guestPassword: z.string().min(1).max(128).optional(),
});
export type DeleteEntryInput = z.infer<typeof deleteEntryDto>;

/** entry list 쿼리. */
export const listEntriesQuery = z.object({
  selectedForVote: z
    .string()
    .transform((v) => v === "true")
    .pipe(z.boolean())
    .optional(),
  status: z.enum(contestEntryStatuses).optional(),
  includeHidden: z
    .string()
    .transform((v) => v === "true" || v === "1")
    .pipe(z.boolean())
    .optional(),
  authorId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListEntriesQuery = z.infer<typeof listEntriesQuery>;

/** 후보 선정 (admin). 단순 toggle. */
export const selectForVoteDto = z.object({
  selectedForVote: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
});
export type SelectForVoteInput = z.infer<typeof selectForVoteDto>;

/** 참가작 검수/숨김 처리 (admin). */
export const updateEntryModerationDto = z.object({
  status: z.enum(contestEntryStatuses).optional(),
  selectedForVote: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});
export type UpdateEntryModerationInput = z.infer<typeof updateEntryModerationDto>;

/** 투표 (회원, 1인 1표). */
export const voteDto = z.object({
  entryId: z.string().uuid(),
});
export type VoteInput = z.infer<typeof voteDto>;

/**
 * 결과 발표 (admin).
 *
 * 두 가지 모드:
 *   - rankings 직접 지정 (수기 보정 포함): [{ entryId, rank, note? }, ...]
 *   - auto=true: 서버가 vote 집계로 자동 rank 산정 (note 는 비어 있음)
 *
 * announceResults 호출 시 기존 contest_results 는 삭제 후 새로 insert
 * (재발표 — admin 본인이 호출하므로 사용자 데이터 변경 금지 정책에 저촉 X).
 */
export const announceResultsDto = z
  .object({
    auto: z.boolean().default(false),
    topN: z.number().int().min(1).max(50).default(3),
    rankings: z
      .array(
        z.object({
          entryId: z.string().uuid(),
          rank: z.number().int().min(1).max(100),
          awardName: z.string().trim().max(80).optional(),
          note: z.string().trim().max(500).optional(),
          reason: z.string().trim().max(500).optional(),
        }),
      )
      .max(50)
      .optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.auto || (v.rankings && v.rankings.length > 0), {
    message: "auto=true 이거나 rankings 가 1개 이상이어야 합니다.",
  });
export type AnnounceResultsInput = z.infer<typeof announceResultsDto>;
