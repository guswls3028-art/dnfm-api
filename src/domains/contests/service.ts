import { and, asc, count, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { verifyPassword } from "../../shared/crypto/password.js";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import { users } from "../auth/schema.js";
import type {
  AnnounceResultsInput,
  CreateContestInput,
  CreateEntryInput,
  ListContestsQuery,
  ListEntriesQuery,
  UpdateContestInput,
  UpdateEntryModerationInput,
} from "./dto.js";
import {
  type Contest,
  type ContestEntry,
  type ContestEntryStatus,
  type ContestStatus,
  auditLogs,
  contestEntries,
  contestResults,
  contestVotes,
  contests,
} from "./schema.js";

/**
 * 비회원 보안 — 응답 projection. authorPasswordHash (bcrypt) + anonymousAuditHash (sha256)
 * 는 어드민 audit 전용. list/create 응답에는 노출 X.
 */
export function publicEntry<
  T extends {
    authorPasswordHash?: string | null;
    anonymousAuditHash?: string | null;
  },
>(row: T) {
  const { authorPasswordHash, anonymousAuditHash, ...rest } = row;
  void authorPasswordHash;
  void anonymousAuditHash;
  return rest;
}

/**
 * 시각 검증 helper — 모든 시각 비교는 서버 시계 기준. 클라이언트 시간 신뢰 X.
 * (route 단에서 새로 new Date() 로 검사하므로 sql now() 와 약간의 drift 는 허용 — 동일 process tick 내).
 */
function now(): Date {
  return new Date();
}

function parseOptionalDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw AppError.badRequest("잘못된 시각 형식입니다.", "invalid_datetime");
  }
  return d;
}

const PUBLIC_ENTRY_STATUSES: ContestEntryStatus[] = ["approved", "winner"];
const BLOCKED_CONTEST_STATUSES: ContestStatus[] = ["archived", "cancelled"];

const CORE_CONTEST_FIELDS = new Set<keyof UpdateContestInput>([
  "title",
  "description",
  "formSchema",
  "maxEntries",
  "entryDeadlineAt",
  "voteStartAt",
  "voteEndAt",
  "coverR2Key",
  "metadata",
]);

function hasCoreContestChange(input: UpdateContestInput): boolean {
  for (const key of CORE_CONTEST_FIELDS) {
    if (input[key] !== undefined) return true;
  }
  return false;
}

function requireReason(reason: string | undefined, message: string): string {
  const trimmed = reason?.trim();
  if (!trimmed) throw AppError.badRequest(message, "reason_required");
  return trimmed;
}

function isPublicEntryStatus(status: ContestEntryStatus): boolean {
  return PUBLIC_ENTRY_STATUSES.includes(status);
}

function canModerateEntries(status: ContestStatus): boolean {
  return !BLOCKED_CONTEST_STATUSES.includes(status);
}

async function writeAuditLog(input: {
  site: SiteCode;
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
}) {
  await db.insert(auditLogs).values({
    site: input.site,
    actorId: input.actorId ?? null,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    before: input.before as Record<string, unknown> | undefined,
    after: input.after as Record<string, unknown> | undefined,
    reason: input.reason?.trim() || null,
  });
}

/* -------------------------------------------------------------------------- */
/* contests CRUD                                                              */
/* -------------------------------------------------------------------------- */

/** 어드민 — 새 콘테스트 생성. (route 에서 isAdmin 검증 후 호출) */
export async function createContest(site: SiteCode, actorId: string, input: CreateContestInput) {
  const entryDeadlineAt = parseOptionalDate(input.entryDeadlineAt) ?? null;
  const voteStartAt = parseOptionalDate(input.voteStartAt) ?? null;
  const voteEndAt = parseOptionalDate(input.voteEndAt) ?? null;

  // sanity — voteStartAt < voteEndAt
  if (voteStartAt && voteEndAt && voteStartAt >= voteEndAt) {
    throw AppError.badRequest(
      "투표 시작 시각이 종료 시각보다 빨라야 합니다.",
      "invalid_vote_window",
    );
  }

  const inserted = await db
    .insert(contests)
    .values({
      site,
      title: input.title,
      description: input.description,
      status: input.status,
      formSchema: input.formSchema as Record<string, unknown>,
      maxEntries: input.maxEntries,
      entryDeadlineAt,
      voteStartAt,
      voteEndAt,
      coverR2Key: input.coverR2Key,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
      createdBy: actorId,
    })
    .returning();
  const contest = inserted[0]!;
  await writeAuditLog({
    site,
    actorId,
    action: "contest.create",
    targetType: "contest",
    targetId: contest.id,
    after: contest,
  });
  return contest;
}

/** 콘테스트 list (사이트별). */
export async function listContests(site: SiteCode, query: ListContestsQuery) {
  const filters = [eq(contests.site, site)];
  if (query.status) filters.push(eq(contests.status, query.status));

  const orderBy =
    query.sort === "popular"
      ? [desc(contests.createdAt)] // popular: entry count 기준은 별도 join — 단순 fallback
      : [desc(contests.createdAt)];

  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(contests)
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(contests)
      .where(and(...filters)),
  ]);

  // popular sort 보강 — entry count 로 정렬 (소수 row 면 in-memory).
  let items = rows;
  if (query.sort === "popular" && rows.length > 0) {
    const ids = rows.map((r) => r.id);
    const counts = await db
      .select({
        contestId: contestEntries.contestId,
        c: count(),
      })
      .from(contestEntries)
      .where(and(isNull(contestEntries.deletedAt)))
      .groupBy(contestEntries.contestId);
    const countMap = new Map<string, number>();
    for (const row of counts) {
      if (ids.includes(row.contestId)) countMap.set(row.contestId, Number(row.c));
    }
    items = [...rows].sort((a, b) => (countMap.get(b.id) ?? 0) - (countMap.get(a.id) ?? 0));
  }

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

/** 콘테스트 단건 조회 — entries/votes count 포함. */
export async function getContest(site: SiteCode, id: string) {
  const rows = await db
    .select()
    .from(contests)
    .where(and(eq(contests.site, site), eq(contests.id, id)))
    .limit(1);
  const contest = rows[0];
  if (!contest) throw AppError.notFound("콘테스트를 찾을 수 없습니다.", "contest_not_found");

  const [entryCountRow, voteCountRow] = await Promise.all([
    db
      .select({ value: count() })
      .from(contestEntries)
      .where(and(eq(contestEntries.contestId, id), isNull(contestEntries.deletedAt))),
    db.select({ value: count() }).from(contestVotes).where(eq(contestVotes.contestId, id)),
  ]);

  return {
    contest,
    counts: {
      entries: entryCountRow[0]?.value ?? 0,
      votes: voteCountRow[0]?.value ?? 0,
    },
  };
}

async function requireContest(site: SiteCode, id: string): Promise<Contest> {
  const rows = await db
    .select()
    .from(contests)
    .where(and(eq(contests.site, site), eq(contests.id, id)))
    .limit(1);
  const contest = rows[0];
  if (!contest) throw AppError.notFound("콘테스트를 찾을 수 없습니다.", "contest_not_found");
  return contest;
}

/** 어드민 — 콘테스트 수정. */
export async function updateContest(
  site: SiteCode,
  id: string,
  actorId: string,
  input: UpdateContestInput,
) {
  const before = await requireContest(site, id);

  if (BLOCKED_CONTEST_STATUSES.includes(before.status) && hasCoreContestChange(input)) {
    throw AppError.badRequest(
      "보관/취소된 콘테스트의 핵심 정보는 수정할 수 없습니다.",
      "contest_readonly",
      { status: before.status },
    );
  }

  const coreChanged = hasCoreContestChange(input);
  const statusChanged = input.status !== undefined && input.status !== before.status;
  let reason: string | undefined;
  if (coreChanged && before.status !== "draft") {
    reason = requireReason(
      input.reason,
      "참가 모집 이후 규칙/기간/상품성 정보 수정에는 사유가 필요합니다.",
    );
  } else if (
    statusChanged &&
    input.status &&
    ["results", "archived", "cancelled"].includes(input.status)
  ) {
    reason = requireReason(input.reason, "결과 발표/보관/취소 상태 변경에는 사유가 필요합니다.");
  } else if (statusChanged) {
    reason = input.reason?.trim() || undefined;
  }

  const patch: Partial<typeof contests.$inferInsert> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description ?? null;
  if (input.formSchema !== undefined)
    patch.formSchema = input.formSchema as Record<string, unknown>;
  if (input.maxEntries !== undefined) patch.maxEntries = input.maxEntries;
  if (input.entryDeadlineAt !== undefined) {
    patch.entryDeadlineAt = parseOptionalDate(input.entryDeadlineAt) ?? null;
  }
  if (input.voteStartAt !== undefined) {
    patch.voteStartAt = parseOptionalDate(input.voteStartAt) ?? null;
  }
  if (input.voteEndAt !== undefined) {
    patch.voteEndAt = parseOptionalDate(input.voteEndAt) ?? null;
  }
  if (input.coverR2Key !== undefined) patch.coverR2Key = input.coverR2Key ?? null;
  if (input.metadata !== undefined) patch.metadata = input.metadata as Record<string, unknown>;
  if (input.status !== undefined) patch.status = input.status as ContestStatus;

  const effectiveVoteStartAt =
    patch.voteStartAt !== undefined ? patch.voteStartAt : before.voteStartAt;
  const effectiveVoteEndAt = patch.voteEndAt !== undefined ? patch.voteEndAt : before.voteEndAt;
  if (effectiveVoteStartAt && effectiveVoteEndAt && effectiveVoteStartAt >= effectiveVoteEndAt) {
    throw AppError.badRequest(
      "투표 시작 시각이 종료 시각보다 빨라야 합니다.",
      "invalid_vote_window",
    );
  }

  const updated = await db.update(contests).set(patch).where(eq(contests.id, id)).returning();
  const after = updated[0]!;
  await writeAuditLog({
    site,
    actorId,
    action: statusChanged && !coreChanged ? "contest.status.update" : "contest.update",
    targetType: "contest",
    targetId: id,
    before,
    after,
    reason,
  });
  return after;
}

/**
 * 어드민 — 콘테스트 삭제.
 *
 * 안전 정책: entry 가 1개라도 있으면 hard delete 금지. status='draft' 인
 * 빈 콘테스트만 즉시 삭제 허용. 그 외는 status 를 별도로 'draft' 로 되돌리거나
 * UI 에서 archived 토글 추가 (다음 cycle).
 *
 * 이유: contest_entries / contest_votes / contest_results 가 cascade 로 같이
 * 지워지는데, entries 는 사용자 작성 데이터. [[domain-policy.md §1]] / [[anti-avoidance.md §8]]
 * 에 따라 자동 destructive 금지.
 */
export async function deleteContest(site: SiteCode, id: string, actorId: string): Promise<void> {
  const before = await requireContest(site, id);
  const entryCount = await db
    .select({ value: count() })
    .from(contestEntries)
    .where(and(eq(contestEntries.contestId, id), isNull(contestEntries.deletedAt)));
  if ((entryCount[0]?.value ?? 0) > 0) {
    throw AppError.forbidden(
      "참가 entry 가 있는 콘테스트는 삭제할 수 없습니다. (사용자 데이터 보호)",
      "contest_has_entries",
    );
  }
  await db.delete(contests).where(eq(contests.id, id));
  await writeAuditLog({
    site,
    actorId,
    action: "contest.delete",
    targetType: "contest",
    targetId: id,
    before,
  });
}

/* -------------------------------------------------------------------------- */
/* entries                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * 참가 등록 (회원).
 *   - contest.status === 'open' 이어야 함
 *   - entryDeadlineAt 이 있고 now > entryDeadlineAt 이면 거부
 *   - maxEntries > 0 면 현재 active entry count < maxEntries 검사
 *   - 사용자가 만든 entry — 자동 변경 영구 금지 (이 service 는 insert only,
 *     update path 별도). createEntry 이후 fields/imageR2Keys 는 본인만 수정.
 */
export async function createEntry(
  site: SiteCode,
  contestId: string,
  authorId: string,
  input: CreateEntryInput,
) {
  const contest = await requireContest(site, contestId);

  if (contest.status !== "open") {
    throw AppError.badRequest("참가가 열려 있지 않은 콘테스트입니다.", "contest_not_open", {
      status: contest.status,
    });
  }
  if (contest.entryDeadlineAt && now() > contest.entryDeadlineAt) {
    throw AppError.badRequest("마감된 콘테스트입니다.", "entry_deadline_passed");
  }
  if (contest.maxEntries > 0) {
    const cnt = await db
      .select({ value: count() })
      .from(contestEntries)
      .where(and(eq(contestEntries.contestId, contestId), isNull(contestEntries.deletedAt)));
    if ((cnt[0]?.value ?? 0) >= contest.maxEntries) {
      throw AppError.badRequest("참가 정원이 다 찼습니다.", "max_entries_reached");
    }
  }

  const inserted = await db
    .insert(contestEntries)
    .values({
      contestId,
      authorId,
      fields: input.fields,
      imageR2Keys: input.imageR2Keys,
    })
    .returning();
  return publicEntry(inserted[0]!);
}

/**
 * 비회원 entry 삭제 — guestPassword 가 authorPasswordHash 와 매치되어야 함.
 * 어드민 / 회원 본인 삭제 path 는 별도 (route 단 권한 분기 후 직접 deleteEntryByAdmin/Author 호출).
 */
export async function deleteEntryAsGuest(
  site: SiteCode,
  contestId: string,
  entryId: string,
  guestPassword: string,
) {
  await requireContest(site, contestId);
  const rows = await db
    .select()
    .from(contestEntries)
    .where(and(eq(contestEntries.id, entryId), eq(contestEntries.contestId, contestId)))
    .limit(1);
  const entry = rows[0];
  if (!entry || entry.deletedAt) {
    throw AppError.notFound("참가작을 찾을 수 없습니다.", "entry_not_found");
  }
  if (entry.authorId !== null) {
    throw AppError.forbidden("회원이 작성한 참가작은 비번 삭제 불가합니다.", "member_entry");
  }
  if (!entry.authorPasswordHash) {
    throw AppError.forbidden("비번 없는 비회원 참가작은 삭제 불가합니다.", "no_guest_password");
  }
  const ok = await verifyPassword(guestPassword, entry.authorPasswordHash);
  if (!ok) {
    throw AppError.forbidden("비밀번호가 일치하지 않습니다.", "password_mismatch");
  }
  await db.update(contestEntries).set({ deletedAt: now() }).where(eq(contestEntries.id, entryId));
  return { deleted: true };
}

/** entry list — 사이트 격리 검증 + 선택 필터. */
export async function listEntries(
  site: SiteCode,
  contestId: string,
  query: ListEntriesQuery,
  options: { includeAll?: boolean } = {},
) {
  await requireContest(site, contestId);

  const filters = [eq(contestEntries.contestId, contestId), isNull(contestEntries.deletedAt)];
  if (!options.includeAll) {
    filters.push(inArray(contestEntries.status, PUBLIC_ENTRY_STATUSES));
  } else if (!query.includeHidden) {
    filters.push(inArray(contestEntries.status, ["submitted", "approved", "winner"]));
  }
  if (query.selectedForVote !== undefined) {
    filters.push(eq(contestEntries.selectedForVote, query.selectedForVote));
  }
  if (query.status) filters.push(eq(contestEntries.status, query.status));
  if (query.authorId) filters.push(eq(contestEntries.authorId, query.authorId));

  const offset = (query.page - 1) * query.pageSize;
  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(contestEntries)
      .where(and(...filters))
      .orderBy(desc(contestEntries.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(contestEntries)
      .where(and(...filters)),
  ]);

  return {
    items: rows.map(publicEntry),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

/** 회원 — 내가 제출한 참가작과 현재 운영 상태. */
export async function listMyContestEntries(site: SiteCode, userId: string) {
  const rows = await db
    .select({
      entry: contestEntries,
      contest: contests,
    })
    .from(contestEntries)
    .innerJoin(contests, eq(contests.id, contestEntries.contestId))
    .where(
      and(
        eq(contests.site, site),
        eq(contestEntries.authorId, userId),
        isNull(contestEntries.deletedAt),
      ),
    )
    .orderBy(desc(contestEntries.createdAt))
    .limit(100);

  return rows.map(({ entry, contest }) => ({
    entry: publicEntry(entry),
    contest,
  }));
}

/** 어드민 — 후보 선정 toggle (selectedForVote). 사용자 entry 내용은 손대지 않음. */
export async function selectEntryForVote(
  site: SiteCode,
  contestId: string,
  entryId: string,
  actorId: string,
  selectedForVote: boolean,
  reason?: string,
) {
  const contest = await requireContest(site, contestId);
  if (!canModerateEntries(contest.status)) {
    throw AppError.badRequest(
      "보관/취소된 콘테스트의 참가작은 변경할 수 없습니다.",
      "contest_readonly",
      { status: contest.status },
    );
  }

  const rows = await db
    .select()
    .from(contestEntries)
    .where(
      and(
        eq(contestEntries.id, entryId),
        eq(contestEntries.contestId, contestId),
        isNull(contestEntries.deletedAt),
      ),
    )
    .limit(1);
  const entry = rows[0];
  if (!entry) throw AppError.notFound("entry 를 찾을 수 없습니다.", "entry_not_found");

  if (selectedForVote && !isPublicEntryStatus(entry.status)) {
    throw AppError.badRequest(
      "승인된 참가작만 투표 후보로 선정할 수 있습니다.",
      "entry_not_approved",
      { status: entry.status },
    );
  }

  const updated = await db
    .update(contestEntries)
    .set({
      selectedForVote,
      selectedAt: selectedForVote ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(contestEntries.id, entryId))
    .returning();
  const after = updated[0]!;
  await writeAuditLog({
    site,
    actorId,
    action: selectedForVote ? "contest_entry.select_for_vote" : "contest_entry.unselect_for_vote",
    targetType: "contest_entry",
    targetId: entryId,
    before: entry,
    after,
    reason,
  });
  return after;
}

/** 어드민 — 참가작 승인/반려/숨김/실격 등 검수 상태 변경. */
export async function updateEntryModeration(
  site: SiteCode,
  contestId: string,
  entryId: string,
  actorId: string,
  input: UpdateEntryModerationInput,
) {
  const contest = await requireContest(site, contestId);
  if (!canModerateEntries(contest.status)) {
    throw AppError.badRequest(
      "보관/취소된 콘테스트의 참가작은 변경할 수 없습니다.",
      "contest_readonly",
      { status: contest.status },
    );
  }

  const rows = await db
    .select()
    .from(contestEntries)
    .where(
      and(
        eq(contestEntries.id, entryId),
        eq(contestEntries.contestId, contestId),
        isNull(contestEntries.deletedAt),
      ),
    )
    .limit(1);
  const entry = rows[0];
  if (!entry) throw AppError.notFound("entry 를 찾을 수 없습니다.", "entry_not_found");

  const nextStatus = input.status ?? entry.status;
  const selectedForVote =
    input.selectedForVote !== undefined ? input.selectedForVote : entry.selectedForVote;
  const reason =
    ["rejected", "hidden", "disqualified"].includes(nextStatus) ||
    entry.status === "winner" ||
    nextStatus === "winner"
      ? requireReason(input.reason, "반려/숨김/실격/수상 상태 변경에는 사유가 필요합니다.")
      : input.reason?.trim() || undefined;

  if (selectedForVote && !isPublicEntryStatus(nextStatus)) {
    throw AppError.badRequest(
      "승인된 참가작만 투표 후보로 선정할 수 있습니다.",
      "entry_not_approved",
      { status: nextStatus },
    );
  }

  const reviewed = input.status !== undefined && input.status !== entry.status;
  const updated = await db
    .update(contestEntries)
    .set({
      status: nextStatus,
      selectedForVote,
      selectedAt:
        selectedForVote && !entry.selectedForVote
          ? new Date()
          : selectedForVote
            ? entry.selectedAt
            : null,
      reviewedBy: reviewed ? actorId : entry.reviewedBy,
      reviewedAt: reviewed ? new Date() : entry.reviewedAt,
      statusReason: reason ?? entry.statusReason,
      updatedAt: new Date(),
    })
    .where(eq(contestEntries.id, entryId))
    .returning();
  const after = updated[0]!;
  await writeAuditLog({
    site,
    actorId,
    action: "contest_entry.moderate",
    targetType: "contest_entry",
    targetId: entryId,
    before: entry,
    after,
    reason,
  });
  return after;
}

/* -------------------------------------------------------------------------- */
/* votes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * 투표.
 *   - contest.status === 'voting'
 *   - voteStartAt ≤ now ≤ voteEndAt
 *   - 대상 entry 는 같은 contest 안 + selectedForVote=true
 *   - (contestId, voterId) unique — 1인 1표 (DB unique 로 강제)
 *   - 본인 entry 에는 투표 불가
 */
export async function voteForEntry(
  site: SiteCode,
  contestId: string,
  voterId: string,
  entryId: string,
) {
  const contest = await requireContest(site, contestId);

  if (contest.status !== "voting") {
    throw AppError.badRequest("투표가 열려 있지 않은 콘테스트입니다.", "contest_not_voting", {
      status: contest.status,
    });
  }
  const t = now();
  if (contest.voteStartAt && t < contest.voteStartAt) {
    throw AppError.badRequest("투표 시작 전입니다.", "vote_not_started");
  }
  if (contest.voteEndAt && t > contest.voteEndAt) {
    throw AppError.badRequest("투표가 종료됐습니다.", "vote_ended");
  }

  const entryRows = await db
    .select()
    .from(contestEntries)
    .where(
      and(
        eq(contestEntries.id, entryId),
        eq(contestEntries.contestId, contestId),
        isNull(contestEntries.deletedAt),
      ),
    )
    .limit(1);
  const entry = entryRows[0];
  if (!entry) throw AppError.notFound("entry 를 찾을 수 없습니다.", "entry_not_found");
  if (!entry.selectedForVote) {
    throw AppError.badRequest("투표 후보가 아닙니다.", "entry_not_selected");
  }
  if (!isPublicEntryStatus(entry.status)) {
    throw AppError.badRequest("공개 승인된 참가작이 아닙니다.", "entry_not_public", {
      status: entry.status,
    });
  }
  if (entry.authorId === voterId) {
    throw AppError.badRequest("본인 작품에는 투표할 수 없습니다.", "self_vote");
  }

  // unique (contestId, voterId) — DB 가 보장. 사전 체크는 친절한 메시지용.
  const prev = await db
    .select()
    .from(contestVotes)
    .where(and(eq(contestVotes.contestId, contestId), eq(contestVotes.voterId, voterId)))
    .limit(1);
  if (prev.length > 0) {
    throw AppError.conflict("이미 투표하셨습니다. (1인 1표)", "already_voted");
  }

  const inserted = await db
    .insert(contestVotes)
    .values({ contestId, voterId, entryId })
    .returning();
  return inserted[0]!;
}

/** entry 별 vote count 집계. */
export async function tallyVotes(site: SiteCode, contestId: string) {
  await requireContest(site, contestId);

  const rows = await db
    .select({
      entryId: contestVotes.entryId,
      votes: count(),
    })
    .from(contestVotes)
    .where(eq(contestVotes.contestId, contestId))
    .groupBy(contestVotes.entryId);

  // 후보 entry 까지 합쳐서 0표 entry 도 보여줌
  const entries = await db
    .select({ id: contestEntries.id, authorId: contestEntries.authorId })
    .from(contestEntries)
    .where(
      and(
        eq(contestEntries.contestId, contestId),
        eq(contestEntries.selectedForVote, true),
        inArray(contestEntries.status, PUBLIC_ENTRY_STATUSES),
        isNull(contestEntries.deletedAt),
      ),
    );

  const voteMap = new Map<string, number>();
  for (const r of rows) voteMap.set(r.entryId, Number(r.votes));

  const tally = entries
    .map((e) => ({ entryId: e.id, authorId: e.authorId, votes: voteMap.get(e.id) ?? 0 }))
    .sort((a, b) => b.votes - a.votes);

  return tally;
}

/** 어드민 — 콘테스트 단위 감사 로그 조회. */
export async function listContestAuditLogs(
  site: SiteCode,
  contestId: string,
  options: { includeEntries?: boolean; limit?: number } = {},
) {
  await requireContest(site, contestId);

  const targetFilters = [
    and(eq(auditLogs.targetType, "contest"), eq(auditLogs.targetId, contestId)),
  ];
  if (options.includeEntries) {
    const entryRows = await db
      .select({ id: contestEntries.id })
      .from(contestEntries)
      .where(eq(contestEntries.contestId, contestId));
    const entryIds = entryRows.map((entry) => entry.id);
    if (entryIds.length > 0) {
      targetFilters.push(
        and(eq(auditLogs.targetType, "contest_entry"), inArray(auditLogs.targetId, entryIds)),
      );
    }
  }

  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.site, site), or(...targetFilters)))
    .orderBy(desc(auditLogs.createdAt))
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 200));
}

/* -------------------------------------------------------------------------- */
/* results                                                                    */
/* -------------------------------------------------------------------------- */

/** 결과 조회 — 발표된 contest_results + entry 정보. */
export async function listResults(site: SiteCode, contestId: string) {
  await requireContest(site, contestId);

  const rows = await db
    .select()
    .from(contestResults)
    .where(eq(contestResults.contestId, contestId))
    .orderBy(asc(contestResults.rank));
  if (rows.length === 0) return [];

  const entryIds = rows.map((r) => r.entryId);
  const entryRows = await db
    .select()
    .from(contestEntries)
    .where(and(eq(contestEntries.contestId, contestId), inArray(contestEntries.id, entryIds)));
  const entriesById = new Map(entryRows.map((entry) => [entry.id, entry]));

  const userIds = entryRows
    .map((entry) => entry.authorId)
    .filter((id): id is string => Boolean(id));
  const userRows =
    userIds.length > 0
      ? await db
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, userIds))
      : [];
  const usersById = new Map(userRows.map((user) => [user.id, user.displayName]));

  return rows.map((result) => {
    const entry = entriesById.get(result.entryId);
    const fields = (entry?.fields ?? {}) as Record<string, unknown>;
    const title = typeof fields.title === "string" ? fields.title : "제목 없음";
    const characterName =
      typeof fields.characterName === "string" ? fields.characterName : undefined;
    const adventureName =
      typeof fields.adventureName === "string" ? fields.adventureName : undefined;
    const authorName = entry?.authorId
      ? usersById.get(entry.authorId) || "회원"
      : entry?.authorNickname ||
        (entry?.anonymousMarker ? `ㅇㅇ(${entry.anonymousMarker})` : "ㅇㅇ");
    return {
      ...result,
      entry: entry ? publicEntry(entry) : null,
      fields,
      title,
      name: title,
      characterName,
      adventureName,
      by: authorName,
      author: authorName,
      comment: result.note,
    };
  });
}

/**
 * 결과 발표 (admin).
 *   - auto=true: tallyVotes 의 votes desc 로 topN 자동 산정 (rank 1..N)
 *   - rankings 지정: admin 이 수기 보정한 rank 사용 (vote count 와 무관)
 *   - 기존 결과는 delete 후 insert (admin 본인 액션 — 사용자 데이터 아님)
 */
export async function announceResults(
  site: SiteCode,
  contestId: string,
  actorId: string,
  input: AnnounceResultsInput,
) {
  const contest = await requireContest(site, contestId);
  if (BLOCKED_CONTEST_STATUSES.includes(contest.status)) {
    throw AppError.badRequest(
      "보관/취소된 콘테스트의 결과는 변경할 수 없습니다.",
      "contest_readonly",
      { status: contest.status },
    );
  }

  const previousResults = await db
    .select()
    .from(contestResults)
    .where(eq(contestResults.contestId, contestId))
    .orderBy(asc(contestResults.rank));
  const publishReason =
    previousResults.length > 0
      ? requireReason(input.reason, "이미 발표된 결과를 변경하려면 사유가 필요합니다.")
      : input.reason?.trim() || undefined;

  let rankings: Array<{
    entryId: string;
    rank: number;
    awardName?: string | undefined;
    note?: string | undefined;
    reason?: string | undefined;
  }>;

  if (input.auto) {
    const tally = await tallyVotes(site, contestId);
    rankings = tally.slice(0, input.topN).map((t, i) => ({
      entryId: t.entryId,
      rank: i + 1,
    }));
    if (rankings.length === 0) {
      throw AppError.badRequest(
        "자동 산정할 후보가 없습니다. 먼저 후보 선정/투표를 진행해 주세요.",
        "no_candidates",
      );
    }
  } else {
    if (!input.rankings || input.rankings.length === 0) {
      throw AppError.badRequest("rankings 가 필요합니다.", "rankings_required");
    }
    rankings = input.rankings.map((r) => ({
      entryId: r.entryId,
      rank: r.rank,
      awardName: r.awardName,
      note: r.note,
      reason: r.reason,
    }));
  }

  // entry 가 모두 같은 contest 인지 검증
  const entryIds = rankings.map((r) => r.entryId);
  const entryRows = await db
    .select({
      id: contestEntries.id,
      contestId: contestEntries.contestId,
      status: contestEntries.status,
    })
    .from(contestEntries)
    .where(and(eq(contestEntries.contestId, contestId), isNull(contestEntries.deletedAt)));
  const validEntryIds = new Set(entryRows.map((e) => e.id));
  const publicEntryIds = new Set(
    entryRows.filter((entry) => isPublicEntryStatus(entry.status)).map((entry) => entry.id),
  );
  for (const id of entryIds) {
    if (!validEntryIds.has(id)) {
      throw AppError.badRequest(
        "rankings 에 다른 콘테스트의 entry 가 섞여 있습니다.",
        "entry_mismatch",
        { entryId: id },
      );
    }
    if (!publicEntryIds.has(id)) {
      throw AppError.badRequest(
        "승인된 참가작만 결과에 등록할 수 있습니다.",
        "entry_not_approved",
        { entryId: id },
      );
    }
  }
  // rank 중복 검증
  const rankSet = new Set<number>();
  for (const r of rankings) {
    if (rankSet.has(r.rank)) {
      throw AppError.badRequest("rank 가 중복됩니다.", "rank_duplicated", { rank: r.rank });
    }
    rankSet.add(r.rank);
  }

  await db.transaction(async (tx) => {
    await tx.delete(contestResults).where(eq(contestResults.contestId, contestId));
    await tx
      .update(contestEntries)
      .set({ status: "approved", updatedAt: new Date() })
      .where(and(eq(contestEntries.contestId, contestId), eq(contestEntries.status, "winner")));
    await tx.insert(contestResults).values(
      rankings.map((r) => ({
        contestId,
        entryId: r.entryId,
        rank: r.rank,
        awardName: r.awardName ?? null,
        note: r.note ?? null,
        reason: r.reason ?? publishReason ?? null,
      })),
    );
    for (const entryId of entryIds) {
      await tx
        .update(contestEntries)
        .set({
          status: "winner",
          reviewedBy: actorId,
          reviewedAt: new Date(),
          statusReason: publishReason ?? "결과 발표",
          updatedAt: new Date(),
        })
        .where(eq(contestEntries.id, entryId));
    }
    await tx
      .update(contests)
      .set({ status: "results", updatedAt: new Date() })
      .where(eq(contests.id, contestId));
  });

  const results = await listResults(site, contestId);
  await writeAuditLog({
    site,
    actorId,
    action: previousResults.length > 0 ? "contest_results.replace" : "contest_results.publish",
    targetType: "contest",
    targetId: contestId,
    before: { contest, results: previousResults },
    after: { status: "results", results },
    reason: publishReason,
  });
  return results;
}
