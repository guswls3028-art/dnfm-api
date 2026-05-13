import { and, eq, desc, asc, sql, count, isNull } from "drizzle-orm";
import {
  buildAnonymousAuditHash,
  buildAnonymousMarker,
  sanitizeGuestNickname,
} from "../../shared/anonymous/anonymous.js";
import { hashPassword, verifyPassword } from "../../shared/crypto/password.js";
import { db } from "../../shared/db/client.js";
import {
  contests,
  contestEntries,
  contestVotes,
  contestResults,
  type Contest,
  type ContestStatus,
} from "./schema.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import type {
  CreateContestInput,
  UpdateContestInput,
  ListContestsQuery,
  CreateEntryInput,
  ListEntriesQuery,
  AnnounceResultsInput,
} from "./dto.js";

export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

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
      createdBy: actorId,
    })
    .returning();
  return inserted[0]!;
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
export async function updateContest(site: SiteCode, id: string, input: UpdateContestInput) {
  await requireContest(site, id);

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
  if (input.status !== undefined) patch.status = input.status as ContestStatus;

  // sanity — voteStartAt < voteEndAt (effective)
  if (patch.voteStartAt && patch.voteEndAt && patch.voteStartAt >= patch.voteEndAt) {
    throw AppError.badRequest(
      "투표 시작 시각이 종료 시각보다 빨라야 합니다.",
      "invalid_vote_window",
    );
  }

  const updated = await db.update(contests).set(patch).where(eq(contests.id, id)).returning();
  return updated[0]!;
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
export async function deleteContest(site: SiteCode, id: string): Promise<void> {
  await requireContest(site, id);
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
  authorId: string | null,
  input: CreateEntryInput,
  ctx: RequestContext = {},
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

  // 비회원 path — IP marker + bcrypt password + audit hash. posts/comments 와 동일 패턴.
  const isGuest = !authorId;
  let guestNickname: string | null = null;
  let guestPasswordHash: string | null = null;
  let anonymousMarker: string | null = null;
  let anonymousAuditHash: string | null = null;
  if (isGuest) {
    guestNickname = sanitizeGuestNickname(input.guestNickname);
    if (input.guestPassword) {
      guestPasswordHash = await hashPassword(input.guestPassword);
    }
    anonymousMarker = buildAnonymousMarker(ctx.ipAddress);
    anonymousAuditHash = buildAnonymousAuditHash(ctx.ipAddress, ctx.userAgent);
  }

  const inserted = await db
    .insert(contestEntries)
    .values({
      contestId,
      authorId,
      authorNickname: guestNickname,
      authorPasswordHash: guestPasswordHash,
      anonymousMarker,
      anonymousAuditHash,
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
  await db
    .update(contestEntries)
    .set({ deletedAt: now() })
    .where(eq(contestEntries.id, entryId));
  return { deleted: true };
}

/** entry list — 사이트 격리 검증 + 선택 필터. */
export async function listEntries(site: SiteCode, contestId: string, query: ListEntriesQuery) {
  await requireContest(site, contestId);

  const filters = [eq(contestEntries.contestId, contestId), isNull(contestEntries.deletedAt)];
  if (query.selectedForVote !== undefined) {
    filters.push(eq(contestEntries.selectedForVote, query.selectedForVote));
  }
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

/** 어드민 — 후보 선정 toggle (selectedForVote). 사용자 entry 내용은 손대지 않음. */
export async function selectEntryForVote(
  site: SiteCode,
  contestId: string,
  entryId: string,
  selectedForVote: boolean,
) {
  const contest = await requireContest(site, contestId);

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

  void contest; // sanity guard — same contest

  const updated = await db
    .update(contestEntries)
    .set({
      selectedForVote,
      selectedAt: selectedForVote ? new Date() : null,
    })
    .where(eq(contestEntries.id, entryId))
    .returning();
  return updated[0]!;
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
  return rows;
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
  input: AnnounceResultsInput,
) {
  await requireContest(site, contestId);

  let rankings: Array<{ entryId: string; rank: number; note?: string | undefined }>;

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
      note: r.note,
    }));
  }

  // entry 가 모두 같은 contest 인지 검증
  const entryIds = rankings.map((r) => r.entryId);
  const entryRows = await db
    .select({ id: contestEntries.id, contestId: contestEntries.contestId })
    .from(contestEntries)
    .where(and(eq(contestEntries.contestId, contestId), isNull(contestEntries.deletedAt)));
  const validEntryIds = new Set(entryRows.map((e) => e.id));
  for (const id of entryIds) {
    if (!validEntryIds.has(id)) {
      throw AppError.badRequest(
        "rankings 에 다른 콘테스트의 entry 가 섞여 있습니다.",
        "entry_mismatch",
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
    await tx.insert(contestResults).values(
      rankings.map((r) => ({
        contestId,
        entryId: r.entryId,
        rank: r.rank,
        note: r.note ?? null,
      })),
    );
    await tx
      .update(contests)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(contests.id, contestId));
  });

  return listResults(site, contestId);
}
