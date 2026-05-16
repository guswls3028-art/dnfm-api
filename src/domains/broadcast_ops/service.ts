import { randomInt } from "node:crypto";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import {
  type ContestStatus,
  auditLogs,
  contestEntries,
  contestVotes,
  contests,
} from "../contests/schema.js";
import type {
  CreateDrawSessionInput,
  CreateQuestionInput,
  ListDrawSessionsQuery,
  ListQuestionsQuery,
  UpdateQuestionInput,
} from "./dto.js";
import {
  type BroadcastQuestionStatus,
  broadcastQuestionStatuses,
  broadcastQuestions,
  drawSessions,
} from "./schema.js";

const ACTIVE_CONTEST_STATUSES: ContestStatus[] = ["open", "closed", "voting", "judging", "results"];

function requireModerationReason(status: BroadcastQuestionStatus, reason?: string): string | null {
  const trimmed = reason?.trim();
  if (["hidden", "rejected"].includes(status) && !trimmed) {
    throw AppError.badRequest("숨김/반려 처리에는 사유가 필요합니다.", "reason_required");
  }
  return trimmed || null;
}

function dedupeParticipants(participants: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of participants) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase("ko-KR");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function pickWinners(participants: string[], winnerCount: number) {
  const pool = [...participants];
  const winners: string[] = [];
  const limit = Math.min(winnerCount, pool.length);
  for (let i = 0; i < limit; i += 1) {
    const idx = randomInt(pool.length);
    const [winner] = pool.splice(idx, 1);
    if (winner) winners.push(winner);
  }
  return winners;
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

export async function createQuestion(
  site: SiteCode,
  userId: string | null,
  input: CreateQuestionInput,
) {
  const inserted = await db
    .insert(broadcastQuestions)
    .values({
      site,
      userId,
      nickname: input.nickname || null,
      category: input.category,
      content: input.content,
      imageR2Key: input.imageR2Key || null,
    })
    .returning();
  return inserted[0]!;
}

export async function listQuestions(site: SiteCode, query: ListQuestionsQuery) {
  const filters = [eq(broadcastQuestions.site, site)];
  if (query.status) filters.push(eq(broadcastQuestions.status, query.status));
  if (query.category) filters.push(eq(broadcastQuestions.category, query.category));

  const offset = (query.page - 1) * query.pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(broadcastQuestions)
      .where(and(...filters))
      .orderBy(desc(broadcastQuestions.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(broadcastQuestions)
      .where(and(...filters)),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

export async function updateQuestionStatus(
  site: SiteCode,
  questionId: string,
  actorId: string,
  input: UpdateQuestionInput,
) {
  const rows = await db
    .select()
    .from(broadcastQuestions)
    .where(and(eq(broadcastQuestions.site, site), eq(broadcastQuestions.id, questionId)))
    .limit(1);
  const before = rows[0];
  if (!before) throw AppError.notFound("질문을 찾을 수 없습니다.", "question_not_found");

  const nextStatus = input.status ?? before.status;
  const reason = requireModerationReason(nextStatus, input.moderationReason);
  const now = new Date();

  await db.transaction(async (tx) => {
    if (nextStatus === "on_air") {
      await tx
        .update(broadcastQuestions)
        .set({ status: "shortlisted", updatedAt: now })
        .where(and(eq(broadcastQuestions.site, site), eq(broadcastQuestions.status, "on_air")));
    }
  });

  const updated = await db
    .update(broadcastQuestions)
    .set({
      status: nextStatus,
      moderatedBy: actorId,
      moderationReason: reason ?? before.moderationReason,
      answeredAt: nextStatus === "answered" ? now : before.answeredAt,
      updatedAt: now,
    })
    .where(eq(broadcastQuestions.id, questionId))
    .returning();
  const after = updated[0]!;

  await writeAuditLog({
    site,
    actorId,
    action: "broadcast_question.status.update",
    targetType: "broadcast_question",
    targetId: questionId,
    before,
    after,
    reason,
  });

  return after;
}

export async function getLiveQuestion(site: SiteCode) {
  const onAir = await db
    .select()
    .from(broadcastQuestions)
    .where(and(eq(broadcastQuestions.site, site), eq(broadcastQuestions.status, "on_air")))
    .orderBy(desc(broadcastQuestions.updatedAt))
    .limit(1);
  if (onAir[0]) return onAir[0];

  const next = await db
    .select()
    .from(broadcastQuestions)
    .where(and(eq(broadcastQuestions.site, site), eq(broadcastQuestions.status, "shortlisted")))
    .orderBy(desc(broadcastQuestions.updatedAt))
    .limit(1);
  return next[0] ?? null;
}

export async function createDrawSession(
  site: SiteCode,
  actorId: string,
  input: CreateDrawSessionInput,
) {
  const participants = dedupeParticipants(input.participants);
  if (participants.length === 0) {
    throw AppError.badRequest("참가자 목록이 비어 있습니다.", "participants_empty");
  }
  if (input.winnerCount > participants.length) {
    throw AppError.badRequest("당첨자 수가 참가자 수보다 많습니다.", "winner_count_too_large");
  }

  const winners = pickWinners(participants, input.winnerCount);
  const inserted = await db
    .insert(drawSessions)
    .values({
      site,
      title: input.title,
      roundNumber: input.roundNumber ?? null,
      prize: input.prize || null,
      participants,
      winners,
      winnerCount: input.winnerCount,
      executedBy: actorId,
      note: input.note || null,
    })
    .returning();
  const session = inserted[0]!;

  await writeAuditLog({
    site,
    actorId,
    action: "draw_session.create",
    targetType: "draw_session",
    targetId: session.id,
    after: session,
    reason: input.note,
  });

  return session;
}

export async function listDrawSessions(site: SiteCode, query: ListDrawSessionsQuery) {
  const offset = (query.page - 1) * query.pageSize;
  const [items, totalRow] = await Promise.all([
    db
      .select()
      .from(drawSessions)
      .where(eq(drawSessions.site, site))
      .orderBy(desc(drawSessions.executedAt))
      .limit(query.pageSize)
      .offset(offset),
    db.select({ value: count() }).from(drawSessions).where(eq(drawSessions.site, site)),
  ]);

  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

export async function getBroadcastDashboard(site: SiteCode) {
  const contestRows = await db
    .select()
    .from(contests)
    .where(and(eq(contests.site, site), inArray(contests.status, ACTIVE_CONTEST_STATUSES)))
    .orderBy(desc(contests.updatedAt))
    .limit(10);

  const contestsWithCounts = await Promise.all(
    contestRows.map(async (contest) => {
      const [entryCountRow, voteCountRow] = await Promise.all([
        db
          .select({ value: count() })
          .from(contestEntries)
          .where(and(eq(contestEntries.contestId, contest.id), isNull(contestEntries.deletedAt))),
        db
          .select({ value: count() })
          .from(contestVotes)
          .where(eq(contestVotes.contestId, contest.id)),
      ]);
      return {
        contest,
        counts: {
          entries: Number(entryCountRow[0]?.value ?? 0),
          votes: Number(voteCountRow[0]?.value ?? 0),
        },
      };
    }),
  );

  const questionCountRows = await db
    .select({
      status: broadcastQuestions.status,
      value: count(),
    })
    .from(broadcastQuestions)
    .where(eq(broadcastQuestions.site, site))
    .groupBy(broadcastQuestions.status);

  const questionCounts = Object.fromEntries(
    broadcastQuestionStatuses.map((status) => [status, 0]),
  ) as Record<BroadcastQuestionStatus, number>;
  for (const row of questionCountRows) {
    questionCounts[row.status] = Number(row.value);
  }

  const recentQuestions = await db
    .select()
    .from(broadcastQuestions)
    .where(
      and(
        eq(broadcastQuestions.site, site),
        inArray(broadcastQuestions.status, ["received", "shortlisted", "on_air"]),
      ),
    )
    .orderBy(desc(broadcastQuestions.updatedAt))
    .limit(10);

  const recentDraws = await db
    .select()
    .from(drawSessions)
    .where(eq(drawSessions.site, site))
    .orderBy(desc(drawSessions.executedAt))
    .limit(5);

  return {
    contests: contestsWithCounts,
    questionCounts,
    recentQuestions,
    recentDraws,
  };
}
