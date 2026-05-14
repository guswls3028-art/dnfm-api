/**
 * seed — idempotent. 운영 카테고리 SSOT.
 *
 * 매 deploy 시 `pnpm db:seed` 호출해도 안전 (upsert).
 * 사이트별 카테고리는 운영 정책상 frontend mock 과 일치하게 박음.
 * 신규 카테고리 추가 시 여기와 frontend content 양쪽 sync.
 */
import "@/shared/http/hono-env.js";
import { logger } from "@/config/logger.js";
import { upsertCategory } from "@/domains/posts/service.js";
import { closeDb } from "@/shared/db/client.js";
import type { SiteCode } from "@/shared/types/site.js";

type SeedCategory = {
  slug: string;
  name: string;
  description?: string;
  sortOrder: number;
  writeRoleMin: "anonymous" | "member" | "admin";
  allowAnonymous: boolean;
  flairs: string[];
};

// 정책 (2026-05-14): 일반 카테고리는 비회원도 작성 가능. IP 끝자리 marker 노출.
// 공지(notice/broadcast)는 admin only 유지.
const NEWB_CATEGORIES: SeedCategory[] = [
  {
    slug: "talk",
    name: "잡담",
    description: "자유롭게 떠드는 곳",
    sortOrder: 10,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["일반", "근황", "친목"],
  },
  {
    slug: "tip",
    name: "팁/정보",
    description: "뉴비 도움 되는 팁",
    sortOrder: 20,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["가이드", "공략", "장비", "스킬"],
  },
  {
    slug: "party",
    name: "파티/모집",
    description: "같이 던전 갈 사람",
    sortOrder: 30,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["모집", "마감"],
  },
  {
    slug: "question",
    name: "질문",
    description: "뉴비 질문 환영",
    sortOrder: 40,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["일반", "장비", "성장", "이벤트"],
  },
  {
    slug: "notice",
    name: "공지",
    description: "방장 공지",
    sortOrder: 1,
    writeRoleMin: "admin",
    allowAnonymous: false,
    flairs: [],
  },
];

const HUROCK_CATEGORIES: SeedCategory[] = [
  {
    slug: "talk",
    name: "잡담",
    description: "허락방 자유 게시판",
    sortOrder: 10,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["일반", "방송"],
  },
  {
    slug: "cheer",
    name: "응원",
    description: "허락님에게 응원 메시지",
    sortOrder: 20,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: [],
  },
  {
    slug: "contest_qa",
    name: "콘테스트 Q&A",
    description: "콘테스트 참가 관련 질문",
    sortOrder: 30,
    writeRoleMin: "anonymous",
    allowAnonymous: true,
    flairs: ["참가", "투표", "결과"],
  },
  {
    slug: "broadcast",
    name: "방송",
    description: "방송 공지/일정",
    sortOrder: 5,
    writeRoleMin: "admin",
    allowAnonymous: false,
    flairs: [],
  },
];

async function seedSite(site: SiteCode, cats: SeedCategory[]) {
  for (const c of cats) {
    const row = await upsertCategory(site, c);
    logger.info({ site, slug: row.slug, id: row.id }, "category upserted");
  }
}

async function main() {
  logger.info("seeding categories…");
  await seedSite("newb", NEWB_CATEGORIES);
  await seedSite("hurock", HUROCK_CATEGORIES);
  logger.info("seed complete");
  await closeDb();
}

main().catch((err) => {
  logger.error({ err }, "seed failed");
  process.exit(1);
});
