import "../../shared/http/hono-env.js";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { confirmUploadDto, createPresignedUrlDto } from "./dto.js";
import { confirmUpload, createPresignedPut } from "./service.js";
import { created, ok } from "../../shared/http/response.js";
import { requireAuth } from "../../shared/http/middleware/auth.js";
import { AppError } from "../../shared/errors/app-error.js";

const uploads = new Hono();

/**
 * POST /uploads/presigned-put — presigned PUT URL 발급.
 * 응답: { uploadId, url, r2Key }
 * 사이트 경계는 uploads 자체에 site 컬럼이 없어 적용하지 않음 — 후속 cycle 에서
 * purpose 별 site scope 필요 시 추가.
 */
uploads.post(
  "/uploads/presigned-put",
  requireAuth(),
  zValidator("json", createPresignedUrlDto),
  async (c) => {
    const userId = c.get("userId");
    const input = c.req.valid("json");
    const result = await createPresignedPut(userId, input);
    return created(c, result);
  },
);

/**
 * POST /uploads/:id/confirm — 업로드 완료 confirm (pending → ready).
 */
uploads.post(
  "/uploads/:id/confirm",
  requireAuth(),
  zValidator("json", confirmUploadDto),
  async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    if (!id) throw AppError.badRequest("upload id required", "id_required");
    const input = c.req.valid("json");
    const upload = await confirmUpload(id, userId, input);
    return ok(c, { upload });
  },
);

export default uploads;
