import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { buildAnonymousAuditHash } from "../../shared/anonymous/anonymous.js";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import { posts } from "../posts/schema.js";
import { comments } from "../comments/schema.js";
import type { CreateReportInput, ListReportsQuery, UpdateReportInput } from "./dto.js";
import { reports, type ReportStatus } from "./schema.js";

export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

/**
 * 자동 숨김 임계치. 동일 target 에 5건 이상 누적되면 post.pinned=false, locked=true
 * 정책은 별도 (즉시 hidden 으로 표시할 deletedAt 처리는 위험하니 admin 검토 큐로).
 * 본 cycle 에서는 count >= AUTO_REVIEW_THRESHOLD 이면 status=in_review 마킹.
 */
const AUTO_REVIEW_THRESHOLD = 5;

/** target (post/comment) 이 해당 site 에 존재하는지 검증. soft-deleted 도 신고 가능. */
async function ensureTargetInSite(
  site: SiteCode,
  targetType: "post" | "comment",
  targetId: string,
): Promise<void> {
  if (targetType === "post") {
    const rows = await db
      .select({ site: posts.site })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    if (!rows[0]) throw AppError.notFound("글을 찾을 수 없습니다.", "post_not_found");
    if (rows[0].site !== site) {
      throw AppError.notFound("글을 찾을 수 없습니다.", "post_not_found");
    }
    return;
  }
  // comment → post 의 site 가 일치하는지 join 으로 확인
  const rows = await db
    .select({ commentId: comments.id, postSite: posts.site })
    .from(comments)
    .leftJoin(posts, eq(posts.id, comments.postId))
    .where(eq(comments.id, targetId))
    .limit(1);
  if (!rows[0]) throw AppError.notFound("댓글을 찾을 수 없습니다.", "comment_not_found");
  if (rows[0].postSite !== site) {
    throw AppError.notFound("댓글을 찾을 수 없습니다.", "comment_not_found");
  }
}

/** 신고 접수. 회원이면 reporterId, 비회원이면 anonymousAuditHash 로 dedup. */
export async function createReport(
  site: SiteCode,
  reporterId: string | null,
  input: CreateReportInput,
  ctx: RequestContext = {},
) {
  await ensureTargetInSite(site, input.targetType, input.targetId);

  const anonymousAuditHash = reporterId
    ? null
    : buildAnonymousAuditHash(ctx.ipAddress, ctx.userAgent);

  // 중복 신고 방지 — 회원이면 unique index 로 conflict, 비회원은 직접 검사
  if (!reporterId && anonymousAuditHash) {
    const dup = await db
      .select({ id: reports.id })
      .from(reports)
      .where(
        and(
          eq(reports.site, site),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.anonymousAuditHash, anonymousAuditHash),
        ),
      )
      .limit(1);
    if (dup[0]) {
      throw AppError.conflict("이미 신고하셨습니다.", "already_reported");
    }
  }

  let inserted;
  try {
    const rows = await db
      .insert(reports)
      .values({
        site,
        targetType: input.targetType,
        targetId: input.targetId,
        reporterId,
        anonymousAuditHash,
        reason: input.reason,
        detail: input.detail,
      })
      .returning();
    inserted = rows[0]!;
  } catch (err: unknown) {
    const e = err as { code?: string; constraint?: string } | undefined;
    // unique 충돌 (회원 중복 신고)
    if (e?.code === "23505") {
      throw AppError.conflict("이미 신고하셨습니다.", "already_reported");
    }
    throw err;
  }

  // 누적 신고 자동 검토 마킹
  const cnt = await db
    .select({ value: count() })
    .from(reports)
    .where(
      and(
        eq(reports.site, site),
        eq(reports.targetType, input.targetType),
        eq(reports.targetId, input.targetId),
        eq(reports.status, "pending"),
      ),
    );
  if ((cnt[0]?.value ?? 0) >= AUTO_REVIEW_THRESHOLD) {
    await db
      .update(reports)
      .set({ status: "in_review", updatedAt: new Date() })
      .where(
        and(
          eq(reports.site, site),
          eq(reports.targetType, input.targetType),
          eq(reports.targetId, input.targetId),
          eq(reports.status, "pending"),
        ),
      );
  }

  // strip audit hash from response
  const { anonymousAuditHash: _strip, ...publicRow } = inserted;
  void _strip;
  return publicRow;
}

/** 신고 목록 — 어드민. */
export async function listReports(site: SiteCode, query: ListReportsQuery) {
  const filters = [eq(reports.site, site)];
  if (query.status) filters.push(eq(reports.status, query.status));
  if (query.targetType) filters.push(eq(reports.targetType, query.targetType));

  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(reports)
      .where(and(...filters))
      .orderBy(desc(reports.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(reports)
      .where(and(...filters)),
  ]);

  return {
    items: rows,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

/** 처리 — 어드민. */
export async function updateReport(
  site: SiteCode,
  reportId: string,
  resolverId: string,
  input: UpdateReportInput,
) {
  const exists = await db
    .select({ id: reports.id, site: reports.site })
    .from(reports)
    .where(eq(reports.id, reportId))
    .limit(1);
  if (!exists[0]) throw AppError.notFound("신고를 찾을 수 없습니다.", "report_not_found");
  if (exists[0].site !== site) {
    throw AppError.notFound("신고를 찾을 수 없습니다.", "report_not_found");
  }

  const finalStatus: ReportStatus = input.status;
  const rows = await db
    .update(reports)
    .set({
      status: finalStatus,
      resolution: input.resolution ?? null,
      resolutionNote: input.resolutionNote ?? null,
      moderatorMemo: input.moderatorMemo ?? null,
      resolvedBy:
        finalStatus === "resolved" || finalStatus === "dismissed" ? resolverId : null,
      resolvedAt:
        finalStatus === "resolved" || finalStatus === "dismissed" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(reports.id, reportId))
    .returning();
  return rows[0]!;
}

/** 같은 글/댓글에 누적된 신고 수 (운영 디스플레이용). */
export async function countByTarget(
  site: SiteCode,
  targetType: "post" | "comment",
  targetId: string,
): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(reports)
    .where(
      and(
        eq(reports.site, site),
        eq(reports.targetType, targetType),
        eq(reports.targetId, targetId),
      ),
    );
  return rows[0]?.value ?? 0;
}

// suppress unused-eslint: drizzle ORM column helpers required at type level
void isNull;
void sql;
