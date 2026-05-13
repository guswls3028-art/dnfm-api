import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../shared/db/client.js";
import { comments } from "./schema.js";
import { posts } from "../posts/schema.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import type {
  CreateCommentInput,
  ListCommentsQuery,
  UpdateCommentInput,
} from "./dto.js";

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
export async function listByPost(
  site: SiteCode,
  postId: string,
  query: ListCommentsQuery,
) {
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
 * 댓글 작성 — 회원. posts.commentCount 동시 증가 (트랜잭션).
 */
export async function createComment(
  site: SiteCode,
  postId: string,
  authorId: string,
  input: CreateCommentInput,
) {
  const post = await ensurePostInSite(site, postId);
  if (post.locked) {
    throw AppError.forbidden("잠긴 글에는 댓글을 달 수 없습니다.", "post_locked");
  }

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(comments)
      .values({
        postId,
        authorId,
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

/** 댓글 수정 — 작성자 본인 또는 admin. */
export async function updateComment(
  site: SiteCode,
  commentId: string,
  actorId: string,
  isAdmin: boolean,
  input: UpdateCommentInput,
) {
  const existing = await getCommentById(site, commentId);
  if (existing.authorId !== actorId && !isAdmin) {
    throw AppError.forbidden("본인 댓글만 수정할 수 있습니다.", "not_author");
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
 * soft delete — 작성자 본인 또는 admin. posts.commentCount 동시 감소.
 */
export async function deleteComment(
  site: SiteCode,
  commentId: string,
  actorId: string,
  isAdmin: boolean,
): Promise<void> {
  const existing = await getCommentById(site, commentId);
  if (existing.authorId !== actorId && !isAdmin) {
    throw AppError.forbidden("본인 댓글만 삭제할 수 있습니다.", "not_author");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(eq(comments.id, commentId));
    // commentCount 가 음수가 되지 않도록 GREATEST 보호
    await tx
      .update(posts)
      .set({
        commentCount: sql`GREATEST(${posts.commentCount} - 1, 0)`,
      })
      .where(eq(posts.id, existing.postId));
  });
}
