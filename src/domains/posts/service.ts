import { and, count, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import {
  buildAnonymousAuditHash,
  buildAnonymousMarker,
  sanitizeGuestNickname,
} from "../../shared/anonymous/anonymous.js";
import { hashPassword, verifyPassword } from "../../shared/crypto/password.js";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import type {
  CreateCategoryInput,
  CreatePostInput,
  ListPostsQuery,
  UpdatePostInput,
} from "./dto.js";
import { users } from "../auth/schema.js";
import { type PostVoteType, postCategories, postVotes, posts } from "./schema.js";

export type RequestContext = {
  ipAddress?: string;
  userAgent?: string;
};

/**
 * post + category 조인 결과 — frontend UI 가 category.name / slug 직접 표시.
 * category 가 null 이면 (orphan) categorySlug/Name 도 null.
 *
 * 비회원 보안:
 *   - authorPasswordHash (bcrypt) 응답에서 strip — 약한 비번 dictionary attack 회피.
 *   - anonymousAuditHash (sha256 IP+UA) 응답에서 strip — 익명성 보존 + fingerprint 노출 방지.
 *   - 어드민 audit endpoint 가 따로 생기면 그쪽에서만 노출.
 */
function enrichPost<
  T extends {
    categoryId: string | null;
    authorPasswordHash?: string | null;
    anonymousAuditHash?: string | null;
  },
>(row: T, category: { id: string; slug: string; name: string } | null) {
  const { authorPasswordHash, anonymousAuditHash, ...publicRow } = row;
  void authorPasswordHash; // strip
  void anonymousAuditHash; // strip
  return {
    ...publicRow,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
  };
}

/** BEST 자동 승격 임계치. (다음 cycle: env / site 별 조정 가능하게) */
const BEST_RECOMMEND_THRESHOLD = 10;

/** 카테고리 조회 (사이트별 list). */
export async function listCategories(site: SiteCode) {
  return db
    .select()
    .from(postCategories)
    .where(eq(postCategories.site, site))
    .orderBy(postCategories.sortOrder);
}

export async function getCategoryById(site: SiteCode, id: string) {
  const rows = await db
    .select()
    .from(postCategories)
    .where(and(eq(postCategories.site, site), eq(postCategories.id, id)))
    .limit(1);
  return rows[0] ?? null;
}

/** 카테고리 생성 (admin). (site, slug) unique 라 중복 시 conflict. */
export async function createCategory(site: SiteCode, input: CreateCategoryInput) {
  const existing = await db
    .select({ id: postCategories.id })
    .from(postCategories)
    .where(and(eq(postCategories.site, site), eq(postCategories.slug, input.slug)))
    .limit(1);
  if (existing.length > 0) {
    throw AppError.conflict("같은 slug 의 카테고리가 이미 있습니다.", "category_slug_taken");
  }
  const inserted = await db
    .insert(postCategories)
    .values({
      site,
      slug: input.slug,
      name: input.name,
      description: input.description,
      sortOrder: input.sortOrder,
      writeRoleMin: input.writeRoleMin,
      allowAnonymous: input.allowAnonymous,
      flairs: input.flairs,
    })
    .returning();
  return inserted[0]!;
}

/** 카테고리 upsert (seed 전용 — idempotent). slug 충돌 시 update. */
export async function upsertCategory(site: SiteCode, input: CreateCategoryInput) {
  const existing = await db
    .select()
    .from(postCategories)
    .where(and(eq(postCategories.site, site), eq(postCategories.slug, input.slug)))
    .limit(1);
  const row = existing[0];
  if (row) {
    const updated = await db
      .update(postCategories)
      .set({
        name: input.name,
        description: input.description,
        sortOrder: input.sortOrder,
        writeRoleMin: input.writeRoleMin,
        allowAnonymous: input.allowAnonymous,
        flairs: input.flairs,
      })
      .where(eq(postCategories.id, row.id))
      .returning();
    return updated[0]!;
  }
  return createCategory(site, input);
}

/**
 * 글 list — 사이트별 격리. cross-site 조회 불가.
 * sort: recent (최신순) / best (추천수) / views (조회수)
 * BEST 만 보기 = postType=best OR pinned=true 정도. 정책 결정 필요.
 */
export async function listPosts(site: SiteCode, query: ListPostsQuery, actorId?: string) {
  const filters = [eq(posts.site, site), isNull(posts.deletedAt)];
  // author=me 는 actor 가 있어야 의미. 없으면 빈 결과.
  if (query.author === "me") {
    if (!actorId) {
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    filters.push(eq(posts.authorId, actorId));
  } else if (typeof query.author === "string") {
    filters.push(eq(posts.authorId, query.author));
  }
  // categoryId 우선, 없으면 categorySlug → id 해석.
  if (query.categoryId) {
    filters.push(eq(posts.categoryId, query.categoryId));
  } else if (query.categorySlug) {
    const catRows = await db
      .select({ id: postCategories.id })
      .from(postCategories)
      .where(and(eq(postCategories.site, site), eq(postCategories.slug, query.categorySlug)))
      .limit(1);
    const catId = catRows[0]?.id;
    if (!catId) {
      // 없는 slug 면 빈 결과. (UI 가 잘못된 카테고리 누른 경우 panic 보다 empty list)
      return { items: [], page: query.page, pageSize: query.pageSize, total: 0 };
    }
    filters.push(eq(posts.categoryId, catId));
  }
  if (query.flair) filters.push(eq(posts.flair, query.flair));
  if (query.postType) filters.push(eq(posts.postType, query.postType));
  if (query.bestOnly) filters.push(eq(posts.postType, "best"));
  if (query.q) {
    const like = `%${query.q}%`;
    filters.push(or(ilike(posts.title, like), ilike(posts.body, like))!);
  }

  const orderBy =
    query.sort === "best"
      ? [desc(posts.recommendCount), desc(posts.createdAt)]
      : query.sort === "views"
        ? [desc(posts.viewCount), desc(posts.createdAt)]
        : [desc(posts.pinned), desc(posts.createdAt)];

  const offset = (query.page - 1) * query.pageSize;

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        post: posts,
        category: {
          id: postCategories.id,
          slug: postCategories.slug,
          name: postCategories.name,
        },
      })
      .from(posts)
      .leftJoin(postCategories, eq(posts.categoryId, postCategories.id))
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(query.pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(posts)
      .where(and(...filters)),
  ]);

  return {
    items: rows.map((r) => enrichPost(r.post, r.category?.id ? r.category : null)),
    page: query.page,
    pageSize: query.pageSize,
    total: totalRow[0]?.value ?? 0,
  };
}

export async function getPostById(site: SiteCode, id: string) {
  const rows = await db
    .select({
      post: posts,
      category: {
        id: postCategories.id,
        slug: postCategories.slug,
        name: postCategories.name,
      },
      author: {
        id: users.id,
        displayName: users.displayName,
        dnfProfile: users.dnfProfile,
        viewerPlatform: users.viewerPlatform,
        viewerNickname: users.viewerNickname,
      },
    })
    .from(posts)
    .leftJoin(postCategories, eq(posts.categoryId, postCategories.id))
    .leftJoin(users, eq(posts.authorId, users.id))
    .where(and(eq(posts.site, site), eq(posts.id, id), isNull(posts.deletedAt)))
    .limit(1);
  const row = rows[0];
  if (!row) throw AppError.notFound("글을 찾을 수 없습니다.", "post_not_found");
  return {
    ...enrichPost(row.post, row.category?.id ? row.category : null),
    // 회원 게시글일 때만 author 객체 — AuthorCard 가 dnfProfile 등 표시.
    // 비회원 글은 author=null (frontend 가 authorNickname 으로 폴백).
    author: row.author?.id ? row.author : null,
  };
}

/** view_count 증가 — fire and forget OK. */
export async function bumpViewCount(postId: string): Promise<void> {
  await db
    .update(posts)
    .set({ viewCount: sql`${posts.viewCount} + 1` })
    .where(eq(posts.id, postId));
}

/** 카테고리·flair 검증 — 글 작성 시. */
async function validateCategoryAndFlair(
  site: SiteCode,
  categoryId: string | undefined,
  flair: string | undefined,
) {
  if (!categoryId) return null;
  const cat = await getCategoryById(site, categoryId);
  if (!cat) throw AppError.badRequest("카테고리를 찾을 수 없습니다.", "category_not_found");
  if (flair && cat.flairs.length > 0 && !cat.flairs.includes(flair)) {
    throw AppError.badRequest("이 카테고리에서 허용되지 않는 말머리입니다.", "invalid_flair", {
      allowed: cat.flairs,
    });
  }
  return cat;
}

/**
 * 글 작성. 회원이면 `authorId`, 비회원이면 `guestNickname` + `guestPassword`.
 * 비회원 작성 시 IP 끝자리 marker + audit hash 저장 (디시 스타일).
 */
export async function createPost(
  site: SiteCode,
  authorId: string | null,
  input: CreatePostInput,
  ctx: RequestContext = {},
) {
  // 회원 / 비회원 분기
  const isGuest = !authorId;
  let guestPasswordHash: string | null = null;
  let guestNickname: string | null = null;
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

  // categoryId 우선, 없으면 slug 해석.
  let resolvedCategoryId = input.categoryId;
  if (!resolvedCategoryId && input.categorySlug) {
    const catRows = await db
      .select({ id: postCategories.id })
      .from(postCategories)
      .where(and(eq(postCategories.site, site), eq(postCategories.slug, input.categorySlug)))
      .limit(1);
    if (!catRows[0]) {
      throw AppError.badRequest("카테고리를 찾을 수 없습니다.", "category_not_found", {
        slug: input.categorySlug,
      });
    }
    resolvedCategoryId = catRows[0].id;
  }

  const cat = await validateCategoryAndFlair(site, resolvedCategoryId, input.flair);

  // 카테고리 자체가 비회원 작성을 허용하는지 검증.
  if (isGuest) {
    if (!cat) {
      throw AppError.badRequest("카테고리를 지정해주세요.", "category_required");
    }
    if (cat.writeRoleMin !== "anonymous") {
      throw AppError.forbidden("이 카테고리는 회원만 작성할 수 있습니다.", "member_required");
    }
  }

  // notice/ad/best 는 일반 회원 작성 금지 (admin 만 — route 단에서 권한 분기)
  const postType = input.postType ?? "normal";
  if (postType !== "normal") {
    throw AppError.forbidden("일반 회원은 이 글 유형을 작성할 수 없습니다.", "post_type_forbidden");
  }

  const inserted = await db
    .insert(posts)
    .values({
      site,
      categoryId: resolvedCategoryId,
      authorId,
      authorNickname: guestNickname,
      authorPasswordHash: guestPasswordHash,
      anonymousMarker,
      anonymousAuditHash,
      title: input.title,
      body: input.body,
      bodyFormat: input.bodyFormat,
      flair: input.flair,
      postType,
      attachmentR2Keys: input.attachmentR2Keys,
    })
    .returning();
  return enrichPost(inserted[0]!, null);
}

/**
 * 비회원 수정/삭제 권한 검증.
 * - 회원이면 authorId 일치만 검증.
 * - 비회원이면 guestPassword 가 저장된 hash 와 일치해야 함.
 * - hash 가 null 인 비회원 글은 본인 수정/삭제 불가 (어드민만).
 *
 * 별도 select 로 hash 직접 fetch — enrichPost (public projection) 가 strip 한 hash 를
 * 다시 응답 path 로 끌어내지 않음.
 */
async function verifyAuthorPermission(
  postId: string,
  actorId: string | null,
  guestPassword: string | undefined,
  isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  const rows = await db
    .select({ authorId: posts.authorId, authorPasswordHash: posts.authorPasswordHash })
    .from(posts)
    .where(eq(posts.id, postId))
    .limit(1);
  const post = rows[0];
  if (!post) return false;
  if (post.authorId) {
    return Boolean(actorId) && post.authorId === actorId;
  }
  if (!post.authorPasswordHash || !guestPassword) return false;
  return verifyPassword(guestPassword, post.authorPasswordHash);
}

/**
 * 글 수정 — 회원 본인 / 비회원 비번 일치 / admin.
 * 비회원이면 input.guestPassword 가 저장된 hash 와 일치해야 함.
 */
export async function updatePost(
  site: SiteCode,
  postId: string,
  actorId: string | null,
  isAdmin: boolean,
  input: UpdatePostInput,
) {
  const existing = await getPostById(site, postId); // site/deleted 검증 + public projection
  const allowed = await verifyAuthorPermission(postId, actorId, input.guestPassword, isAdmin);
  if (!allowed) {
    throw AppError.forbidden("수정 권한이 없습니다.", "not_author");
  }
  void existing; // site check 만 사용

  // pinned / locked 는 admin 만
  if ((input.pinned !== undefined || input.locked !== undefined) && !isAdmin) {
    throw AppError.forbidden("pinned/locked 변경은 운영자만 가능합니다.", "admin_only");
  }

  const updated = await db
    .update(posts)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.body !== undefined && { body: input.body }),
      ...(input.bodyFormat !== undefined && { bodyFormat: input.bodyFormat }),
      ...(input.flair !== undefined && { flair: input.flair }),
      ...(input.pinned !== undefined && { pinned: input.pinned }),
      ...(input.locked !== undefined && { locked: input.locked }),
      ...(input.attachmentR2Keys !== undefined && {
        attachmentR2Keys: input.attachmentR2Keys,
      }),
      updatedAt: new Date(),
    })
    .where(eq(posts.id, postId))
    .returning();
  return enrichPost(updated[0]!, null);
}

/**
 * soft delete — 회원 본인 / 비회원 비번 일치 / admin.
 */
export async function deletePost(
  site: SiteCode,
  postId: string,
  actorId: string | null,
  isAdmin: boolean,
  guestPassword?: string,
): Promise<void> {
  const existing = await getPostById(site, postId); // site/deleted 검증
  const allowed = await verifyAuthorPermission(postId, actorId, guestPassword, isAdmin);
  if (!allowed) {
    throw AppError.forbidden("삭제 권한이 없습니다.", "not_author");
  }
  void existing;
  await db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
}

/**
 * 추천 / 비추천 토글. (post_id, voter_id) unique 라 update 또는 insert.
 * 카운터 (recommend_count / downvote_count) 도 갱신.
 * 추천 누적이 BEST 임계치 도달하면 post_type 자동 승격.
 */
export async function votePost(
  site: SiteCode,
  postId: string,
  voterId: string,
  voteType: PostVoteType,
) {
  const post = await getPostById(site, postId);
  if (post.authorId === voterId) {
    throw AppError.badRequest("본인 글에는 투표할 수 없습니다.", "self_vote");
  }

  // 기존 표 조회
  const prev = await db
    .select()
    .from(postVotes)
    .where(and(eq(postVotes.postId, postId), eq(postVotes.voterId, voterId)))
    .limit(1);
  const prevRow = prev[0];

  await db.transaction(async (tx) => {
    if (prevRow) {
      if (prevRow.voteType === voteType) {
        // 같은 방향 → 토글 취소
        await tx.delete(postVotes).where(eq(postVotes.id, prevRow.id));
        if (voteType === "recommend") {
          await tx
            .update(posts)
            .set({ recommendCount: sql`${posts.recommendCount} - 1` })
            .where(eq(posts.id, postId));
        } else {
          await tx
            .update(posts)
            .set({ downvoteCount: sql`${posts.downvoteCount} - 1` })
            .where(eq(posts.id, postId));
        }
      } else {
        // 방향 전환
        await tx
          .update(postVotes)
          .set({ voteType, createdAt: new Date() })
          .where(eq(postVotes.id, prevRow.id));
        if (voteType === "recommend") {
          await tx
            .update(posts)
            .set({
              recommendCount: sql`${posts.recommendCount} + 1`,
              downvoteCount: sql`${posts.downvoteCount} - 1`,
            })
            .where(eq(posts.id, postId));
        } else {
          await tx
            .update(posts)
            .set({
              recommendCount: sql`${posts.recommendCount} - 1`,
              downvoteCount: sql`${posts.downvoteCount} + 1`,
            })
            .where(eq(posts.id, postId));
        }
      }
    } else {
      // 새 표
      await tx.insert(postVotes).values({ postId, voterId, voteType });
      if (voteType === "recommend") {
        await tx
          .update(posts)
          .set({ recommendCount: sql`${posts.recommendCount} + 1` })
          .where(eq(posts.id, postId));
      } else {
        await tx
          .update(posts)
          .set({ downvoteCount: sql`${posts.downvoteCount} + 1` })
          .where(eq(posts.id, postId));
      }
    }

    // BEST 자동 승격 — 추천 임계치 도달 + 아직 best 아닌 경우.
    const after = await tx.select().from(posts).where(eq(posts.id, postId)).limit(1);
    const cur = after[0]!;
    if (cur.recommendCount >= BEST_RECOMMEND_THRESHOLD && cur.postType === "normal") {
      await tx
        .update(posts)
        .set({ postType: "best", promotedAt: new Date() })
        .where(eq(posts.id, postId));
    }
  });

  const refreshed = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  return refreshed[0]!;
}
