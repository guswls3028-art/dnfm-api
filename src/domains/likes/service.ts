import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/client.js";
import { likes } from "./schema.js";
import type { LikeInput } from "./dto.js";

/**
 * 좋아요 토글.
 *   - (userId, targetType, targetId) unique 라 존재 여부로 토글.
 *   - 존재 → delete (liked=false), 없으면 insert (liked=true).
 *
 * target_type 별 denormalized count (예: posts.recommendCount, comments 의 like 카운터)
 * 갱신은 별도 cycle — target 도메인별 schema 변경 후 일괄 적용.
 *
 * site 격리 검증은 target 도메인이 site 컬럼을 갖고 있는 경우에만 가능.
 * 현재 likes 테이블 자체는 site 없음 — 격리는 route 레벨 site param + 향후
 * target 도메인 join 검증으로 강화.
 */
export async function toggleLike(
  userId: string,
  input: LikeInput,
): Promise<{ liked: boolean }> {
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
