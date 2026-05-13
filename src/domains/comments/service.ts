import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import {
  buildAnonymousAuditHash,
  buildAnonymousMarker,
  sanitizeGuestNickname,
} from "../../shared/anonymous/anonymous.js";
import { hashPassword, verifyPassword } from "../../shared/crypto/password.js";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import { posts } from "../posts/schema.js";
import type { CreateCommentInput, ListCommentsQuery, UpdateCommentInput } from "./dto.js";
import { comments } from "./schema.js";

export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

/**
 * post 가 해당 site 에 속하고 살아 있는지 확인. cross-site 격리.
 */
async function ensurePostInSite(site: SiteCode, postId: string) {
  const rows = await db
    .select()
    .from(posts)
    .where(and(eq(posts.site, site), eq(posts.id, postId), isNull(posts.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw AppError.notFound("글을 찾을 수 없습니다.", "post_not_found");
  return row;
}

/** post 별 댓글 list (soft delete 제외). 오래된 순. */
export async function listByPost(site: SiteCode, postId: string, query: ListCommentsQuery) {
  // site 격리 — post 가 해당 site 에 있는지 확인
  await ensurePostInSite(site, postId);

  const filters = [eq(comments.postId, postId), isNull(comments.deletedAt)];
  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(and(...filters))
      .orderBy(asc(comments.createdAt))
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(comments)
      .where(and(...filters)),
  ]);

  return {
    items: rows,
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

/** 댓글 단건 조회 (soft delete 제외). site 격리 검사 포함. */
export async function getCommentById(site: SiteCode, id: string) {
  const rows = await db
    .select()
    .from(comments)
    .where(and(eq(comments.id, id), isNull(comments.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw AppError.notFound("댓글을 찾을 수 없습니다.", "comment_not_found");
  // post 가 같은 site 인지 확인
  await ensurePostInSite(site, row.postId);
  return row;
}

/**
 * 댓글 작성. 회원이면 authorId, 비회원이면 guestNickname + guestPassword.
 * posts.commentCount 동시 증가 (트랜잭션).
 */
export async function createComment(
  site: SiteCode,
  postId: string,
  authorId: string | null,
  input: CreateCommentInput,
  ctx: RequestContext = {},
) {
  const post = await ensurePostInSite(site, postId);
  if (post.locked) {
    throw AppError.forbidden("잠긴 글에는 댓글을 달 수 없습니다.", "post_locked");
  }

  const isGuest = !authorId;
  const guestNickname = isGuest ? sanitizeGuestNickname(input.guestNickname) : null;
  const guestPasswordHash =
    isGuest && input.guestPassword ? await hashPassword(input.guestPassword) : null;
  const anonymousMarker = isGuest ? buildAnonymousMarker(ctx.ipAddress) : null;
  const anonymousAuditHash = isGuest ? buildAnonymousAuditHash(ctx.ipAddress, ctx.userAgent) : null;

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(comments)
      .values({
        postId,
        authorId,
        authorNickname: guestNickname,
        authorPasswordHash: guestPasswordHash,
        anonymousMarker,
        anonymousAuditHash,
        body: input.body,
      })
      .returning();
    await tx
      .update(posts)
      .set({ commentCount: sql`${posts.commentCount} + 1` })
      .where(eq(posts.id, postId));
    return rows[0]!;
  });
  return inserted;
}

/** 비회원 수정/삭제 권한 검증 (posts 와 동일 패턴). */
async function verifyAuthorPermission(
  comment: { authorId: string | null; authorPasswordHash: string | null },
  actorId: string | null,
  guestPassword: string | undefined,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  if (comment.authorId) {
    return Boolean(actorId) && comment.authorId === actorId;
  }
  if (!comment.authorPasswordHash || !guestPassword) return false;
  return verifyPassword(guestPassword, comment.authorPasswordHash);
}

/** 댓글 수정 — 회원 본인 / 비회원 비번 일치 / admin. */
export async function updateComment(
  site: SiteCode,
  commentId: string,
  actorId: string | null,
  isAdmin: boolean,
  input: UpdateCommentInput,
) {
  const existing = await getCommentById(site, commentId);
  const allowed = await verifyAuthorPermission(existing, actorId, input.guestPassword, isAdmin);
  if (!allowed) {
    throw AppError.forbidden("수정 권한이 없습니다.", "not_author");
  }
  const updated = await db
    .update(comments)
    .set({
      body: input.body,
      updatedAt: new Date(),
    })
    .where(eq(comments.id, commentId))
    .returning();
  return updated[0]!;
}

/**
 * soft delete — 회원 본인 / 비회원 비번 일치 / admin.
 * posts.commentCount 동시 감소.
 */
export async function deleteComment(
  site: SiteCode,
  commentId: string,
  actorId: string | null,
  isAdmin: boolean,
  guestPassword?: string,
): Promise<void> {
  const existing = await getCommentById(site, commentId);
  const allowed = await verifyAuthorPermission(existing, actorId, guestPassword, isAdmin);
  if (!allowed) {
    throw AppError.forbidden("삭제 권한이 없습니다.", "not_author");
  }
  await db.transaction(async (tx) => {
    await tx.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
    // commentCount 가 음수가 되지 않도록 GREATEST 보호
    await tx
      .update(posts)
      .set({
        commentCount: sql`GREATEST(${posts.commentCount} - 1, 0)`,
      })
      .where(eq(posts.id, existing.postId));
  });
}
