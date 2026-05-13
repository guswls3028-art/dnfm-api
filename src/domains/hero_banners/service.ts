import { and, asc, eq } from "drizzle-orm";
import { db } from "@/shared/db/client.js";
import { heroBanners } from "./schema.js";
import type { SiteCode } from "@/shared/types/site.js";
import type { CreateHeroBannerInput, UpdateHeroBannerInput } from "./dto.js";
import { AppError } from "@/shared/errors/app-error.js";

export async function listHeroBanners(site: SiteCode, opts: { includeInactive?: boolean } = {}) {
  const filters = opts.includeInactive
    ? eq(heroBanners.site, site)
    : and(eq(heroBanners.site, site), eq(heroBanners.active, true));
  const rows = await db
    .select()
    .from(heroBanners)
    .where(filters)
    .orderBy(asc(heroBanners.sortOrder), asc(heroBanners.createdAt));
  return rows;
}

export async function createHeroBanner(site: SiteCode, userId: string, input: CreateHeroBannerInput) {
  const [row] = await db
    .insert(heroBanners)
    .values({
      site,
      imageUrl: input.imageUrl,
      linkUrl: input.linkUrl ?? null,
      label: input.label ?? null,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      createdBy: userId,
    })
    .returning();
  return row;
}

export async function updateHeroBanner(
  site: SiteCode,
  id: string,
  input: UpdateHeroBannerInput,
) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
  if (input.linkUrl !== undefined) patch.linkUrl = input.linkUrl;
  if (input.label !== undefined) patch.label = input.label;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.active !== undefined) patch.active = input.active;

  const [row] = await db
    .update(heroBanners)
    .set(patch)
    .where(and(eq(heroBanners.id, id), eq(heroBanners.site, site)))
    .returning();
  if (!row) throw AppError.notFound("배너를 찾을 수 없습니다.", "banner_not_found");
  return row;
}

export async function deleteHeroBanner(site: SiteCode, id: string) {
  const [row] = await db
    .delete(heroBanners)
    .where(and(eq(heroBanners.id, id), eq(heroBanners.site, site)))
    .returning({ id: heroBanners.id });
  if (!row) throw AppError.notFound("배너를 찾을 수 없습니다.", "banner_not_found");
  return row;
}
