import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import type { SiteCode } from "../../shared/types/site.js";
import { posts } from "../posts/schema.js";
import { comments } from "../comments/schema.js";
import { contestEntries, contests } from "../contests/schema.js";
import { likes } from "./schema.js";
import type { LikeInput } from "./dto.js";

/**
 * 좋아요 target 이 요청 site 에 실제로 속하는지 검증.
 *
 * likes 테이블 자체는 site 없는 다형(post/comment/contest_entry) 테이블이라,
 * site 격리는 토글 직전 target 도메인 join 으로 강제한다. 타사이트 target id 를
 * 알고 있어도 다른 site 경로로는 like row 를 만들 수 없다. 불일치는 not-found
 * 로 응답(존재 자체를 노출하지 않음 — reports.ensureTargetInSite 와 동일 정책).
 */
async function ensureLikeTargetInSite(
  site: SiteCode,
  targetType: LikeInput["targetType"],
  targetId: string,
): Promise<void> {
  if (targetType === "post") {
    const rows = await db
      .select({ site: posts.site })
      .from(posts)
      .where(eq(posts.id, targetId))
      .limit(1);
    if (!rows[0] || rows[0].site !== site) {
      throw AppError.notFound("대상을 찾을 수 없습니다.", "like_target_not_found");
    }
    return;
  }

  if (targetType === "comment") {
    const rows = await db
      .select({ postSite: posts.site })
      .from(comments)
      .leftJoin(posts, eq(posts.id, comments.postId))
      .where(eq(comments.id, targetId))
      .limit(1);
    if (!rows[0] || rows[0].postSite !== site) {
      throw AppError.notFound("대상을 찾을 수 없습니다.", "like_target_not_found");
    }
    return;
  }

  // contest_entry → contest 의 site 가 일치하는지 join 으로 확인
  const rows = await db
    .select({ contestSite: contests.site })
    .from(contestEntries)
    .leftJoin(contests, eq(contests.id, contestEntries.contestId))
    .where(eq(contestEntries.id, targetId))
    .limit(1);
  if (!rows[0] || rows[0].contestSite !== site) {
    throw AppError.notFound("대상을 찾을 수 없습니다.", "like_target_not_found");
  }
}

/**
 * 좋아요 토글.
 *   - 토글 전 target 이 요청 site 에 속하는지 검증(사이트 격리).
 *   - (userId, targetType, targetId) unique 라 존재 여부로 토글.
 *   - 존재 → delete (liked=false), 없으면 insert (liked=true).
 *
 * target_type 별 denormalized count (예: posts.recommendCount, comments 의 like
 * 카운터) 갱신은 별도 cycle. site 검증을 토글 진입에서 강제하므로 향후 카운터를
 * 도입해도 교차사이트 중복집계가 발생하지 않는다.
 */
export async function toggleLike(
  site: SiteCode,
  userId: string,
  input: LikeInput,
): Promise<{ liked: boolean }> {
  await ensureLikeTargetInSite(site, input.targetType, input.targetId);

  const existing = await db
    .select()
    .from(likes)
    .where(
      and(
        eq(likes.userId, userId),
        eq(likes.targetType, input.targetType),
        eq(likes.targetId, input.targetId),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await db.delete(likes).where(eq(likes.id, existing[0].id));
    return { liked: false };
  }

  await db.insert(likes).values({
    userId,
    targetType: input.targetType,
    targetId: input.targetId,
  });
  return { liked: true };
}
