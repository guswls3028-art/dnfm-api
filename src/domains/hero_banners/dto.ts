import { z } from "zod";

const urlOrPath = z.string().trim().min(1).max(2000);

export const createHeroBannerDto = z.object({
  imageUrl: urlOrPath,
  linkUrl: urlOrPath.optional().nullable(),
  label: z.string().trim().max(80).optional().nullable(),
  sortOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});
export type CreateHeroBannerInput = z.infer<typeof createHeroBannerDto>;

export const updateHeroBannerDto = createHeroBannerDto.partial();
export type UpdateHeroBannerInput = z.infer<typeof updateHeroBannerDto>;
