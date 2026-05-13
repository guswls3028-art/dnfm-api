import "../../shared/http/hono-env.js";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { requireAuth } from "../../shared/http/middleware/auth.js";
import { created, ok } from "../../shared/http/response.js";
import { requireUuid } from "../../shared/validation/uuid.js";
import { confirmUploadDto, createPresignedUrlDto } from "./dto.js";
import { confirmUpload, createPresignedPut, uploadFileDirect } from "./service.js";
import { hasAnyAdminRole } from "../../shared/auth/permissions.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getPresignedGetUrl } from "../../shared/storage/r2-client.js";
import { uploadPurposes } from "./dto.js";

const uploads = new Hono();

/**
 * POST /uploads/presigned-put — presigned PUT URL 발급.
 * 응답: { uploadId, putUrl, r2Key }
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
    if (input.purpose === "hero_banner") {
      const allowed = await hasAnyAdminRole(userId);
      if (!allowed) {
        throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
      }
    }
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
    const id = requireUuid(c.req.param("id"), "upload_not_found");
    const input = c.req.valid("json");
    const upload = await confirmUpload(id, userId, input);
    return ok(c, { upload });
  },
);

/**
 * POST /uploads/file — multipart 직접 업로드.
 * presigned PUT 대신 backend 가 R2 에 PUT 해 CORS 회피.
 * form fields:
 *   - file: File
 *   - purpose: "hero_banner" | ... (from uploadPurposes)
 */
uploads.post("/uploads/file", requireAuth(), async (c) => {
  const userId = c.get("userId");
  const form = await c.req.formData();
  const file = form.get("file");
  const purposeRaw = String(form.get("purpose") || "");

  if (!(file instanceof File)) {
    throw AppError.badRequest("file 필드가 없거나 형식이 아닙니다.", "missing_file");
  }
  if (!uploadPurposes.includes(purposeRaw as (typeof uploadPurposes)[number])) {
    throw AppError.badRequest("purpose 가 올바르지 않습니다.", "invalid_purpose");
  }
  const purpose = purposeRaw as (typeof uploadPurposes)[number];

  if (purpose === "hero_banner") {
    const allowed = await hasAnyAdminRole(userId);
    if (!allowed) {
      throw AppError.forbidden("운영자 권한이 필요합니다.", "admin_required");
    }
  }

  if (file.size > 10 * 1024 * 1024) {
    throw AppError.badRequest("10MB 이하 파일만 가능합니다.", "file_too_large");
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const result = await uploadFileDirect(userId, {
    purpose,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    body: buf,
  });
  return created(c, result);
});

/**
 * GET /uploads/r2/* — R2 객체를 사용자 브라우저에 노출.
 * R2_PUBLIC_BASE 가 설정 안 됐을 때의 fallback: 302 redirect → presigned GET URL.
 * presigned URL 은 짧은 TTL 이라 브라우저가 따라가는 즉시 만료되어도 OK.
 */
uploads.get("/uploads/r2/*", async (c) => {
  const fullPath = c.req.path; // "/uploads/r2/<key...>"
  const key = decodeURIComponent(fullPath.replace(/^\/uploads\/r2\//, ""));
  if (!key) {
    throw AppError.notFound("키가 없습니다.", "missing_key");
  }
  const presigned = await getPresignedGetUrl(key, 3600);
  return c.redirect(presigned, 302);
});

export default uploads;
