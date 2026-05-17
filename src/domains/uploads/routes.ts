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
 * R2 공개 프록시가 서빙해도 되는 key 네임스페이스.
 * buildR2Key 가 만드는 `<purpose>/<userId-uuid>/<uuid>` 형태만 허용한다.
 * 이 정규식 밖의 임의 버킷 key(설정/백업/타 네임스페이스)는 프록시 불가 —
 * 공개 이미지 서빙(글 사진/배너/참가작)은 그대로 동작하면서 임의 객체
 * 열람만 차단(defense-in-depth).
 */
const R2_PUBLIC_KEY_RE = new RegExp(
  `^(${uploadPurposes.join("|")})/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}$`,
);

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
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch (err) {
    throw AppError.badRequest("multipart/form-data 형식이 아닙니다.", "invalid_form");
  }
  const fileEntry = form.get("file");
  const purposeRaw = String(form.get("purpose") || "");

  // file-like 검사 (Blob | File 모두 OK — duck typing)
  if (
    !fileEntry ||
    typeof fileEntry === "string" ||
    typeof (fileEntry as Blob).arrayBuffer !== "function"
  ) {
    throw AppError.badRequest("file 필드가 없거나 형식이 아닙니다.", "missing_file");
  }
  const file = fileEntry as Blob & { name?: string; type?: string; size: number };

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
  // 업로드 네임스페이스(buildR2Key 형태) 밖의 임의 R2 객체 프록시 차단.
  if (!R2_PUBLIC_KEY_RE.test(key)) {
    throw AppError.notFound("키가 없습니다.", "missing_key");
  }
  const presigned = await getPresignedGetUrl(key, 3600);
  return c.redirect(presigned, 302);
});

export default uploads;
