import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../shared/db/client.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getPresignedPutUrl, putObject } from "../../shared/storage/r2-client.js";
import type { ConfirmUploadInput, CreatePresignedUrlInput, UploadPurpose } from "./dto.js";
import { uploads } from "./schema.js";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const PURPOSE_MAX_BYTES: Record<UploadPurpose, number> = {
  avatar: 5 * 1024 * 1024,
  dnf_capture: 10 * 1024 * 1024,
  contest_entry: 10 * 1024 * 1024,
  post_attachment: 20 * 1024 * 1024,
  hero_banner: 10 * 1024 * 1024,
};

function assertUploadPolicy(input: {
  purpose: UploadPurpose;
  contentType: string;
  sizeBytes: number;
  body?: Buffer | Uint8Array;
}) {
  const maxBytes = PURPOSE_MAX_BYTES[input.purpose];
  if (input.sizeBytes > maxBytes) {
    throw AppError.badRequest(
      `${Math.floor(maxBytes / 1024 / 1024)}MB 이하 파일만 가능합니다.`,
      "file_too_large",
      { purpose: input.purpose, maxBytes },
    );
  }

  if (
    ["avatar", "dnf_capture", "contest_entry", "hero_banner"].includes(input.purpose) &&
    !IMAGE_MIME_TYPES.has(input.contentType)
  ) {
    throw AppError.badRequest(
      "이미지 파일은 jpg/png/webp/gif 형식만 가능합니다.",
      "invalid_image_type",
      { contentType: input.contentType },
    );
  }

  if (input.body && IMAGE_MIME_TYPES.has(input.contentType) && !looksLikeImage(input.body)) {
    throw AppError.badRequest(
      "이미지 파일 내용과 형식이 일치하지 않습니다.",
      "invalid_image_signature",
    );
  }
}

function looksLikeImage(body: Buffer | Uint8Array): boolean {
  const b = body instanceof Buffer ? body : Buffer.from(body);
  if (b.length < 12) return false;
  // jpg
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;
  // png
  if (
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47 &&
    b[4] === 0x0d &&
    b[5] === 0x0a &&
    b[6] === 0x1a &&
    b[7] === 0x0a
  ) {
    return true;
  }
  // gif
  if (b.subarray(0, 6).toString("ascii") === "GIF87a") return true;
  if (b.subarray(0, 6).toString("ascii") === "GIF89a") return true;
  // webp: RIFF....WEBP
  if (
    b.subarray(0, 4).toString("ascii") === "RIFF" &&
    b.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return true;
  }
  return false;
}

/**
 * r2Key → 공개 URL.
 *   - R2_PUBLIC_BASE 설정 시 그 도메인 직접 사용 (CF R2 public dev URL or 커스텀 도메인).
 *   - 미설정 시 api 의 /uploads/r2/<key> proxy 경로 사용 (presigned GET redirect).
 */
export function r2KeyToPublicUrl(r2Key: string): string {
  if (env.R2_PUBLIC_BASE) {
    return `${env.R2_PUBLIC_BASE.replace(/\/+$/, "")}/${r2Key}`;
  }
  return `https://api.dnfm.kr/uploads/r2/${encodeURIComponent(r2Key)}`;
}

/**
 * R2 키 생성 규칙: `<purpose>/<userId>/<uuid>`
 * 충돌 방지 + owner 추적 + purpose 별 prefix 로 lifecycle policy 적용 가능.
 */
function buildR2Key(purpose: string, userId: string): string {
  return `${purpose}/${userId}/${randomUUID()}`;
}

/**
 * presigned PUT URL 발급.
 *   - uploads row 를 status=pending 으로 미리 생성.
 *   - R2 presigned PUT URL 발급해 클라에게 반환.
 *   - 클라는 R2 에 PUT 후 /uploads/:id/confirm 호출.
 */
export async function createPresignedPut(
  ownerId: string,
  input: CreatePresignedUrlInput,
): Promise<{ uploadId: string; putUrl: string; r2Key: string; publicUrl: string }> {
  assertUploadPolicy(input);
  const r2Key = buildR2Key(input.purpose, ownerId);

  // DB row 먼저 생성 — 실패 시 R2 호출 안 함
  const inserted = await db
    .insert(uploads)
    .values({
      ownerId,
      r2Key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      purpose: input.purpose,
      status: "pending",
    })
    .returning();
  const row = inserted[0]!;

  // R2 presigned URL 발급
  const putUrl = await getPresignedPutUrl(r2Key, input.contentType);
  return { uploadId: row.id, putUrl, r2Key, publicUrl: r2KeyToPublicUrl(r2Key) };
}

/**
 * 업로드 완료 confirm — status pending → ready.
 *   - 본인 row 만 confirm 가능.
 *   - 이미 ready 상태면 idempotent OK (다시 ready 로 set).
 *   - deleted 상태는 거부.
 */
export async function confirmUpload(uploadId: string, ownerId: string, input: ConfirmUploadInput) {
  const rows = await db
    .select()
    .from(uploads)
    .where(and(eq(uploads.id, uploadId), eq(uploads.ownerId, ownerId)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw AppError.notFound("업로드를 찾을 수 없습니다.", "upload_not_found");
  }
  if (row.status === "deleted") {
    throw AppError.badRequest("삭제된 업로드입니다.", "upload_deleted");
  }

  const updated = await db
    .update(uploads)
    .set({
      status: "ready",
      confirmedAt: new Date(),
      ...(input.sizeBytes !== undefined && { sizeBytes: input.sizeBytes }),
    })
    .where(eq(uploads.id, uploadId))
    .returning();
  const confirmed = updated[0]!;
  return { ...confirmed, publicUrl: r2KeyToPublicUrl(confirmed.r2Key) };
}

/**
 * multipart 본문을 받아 backend 가 직접 R2 에 PUT. CORS 우회.
 * uploads row 를 ready 로 바로 생성. R2 PUT 후 publicUrl 반환.
 */
export async function uploadFileDirect(
  ownerId: string,
  input: {
    purpose: UploadPurpose;
    contentType: string;
    sizeBytes: number;
    body: Buffer | Uint8Array;
  },
): Promise<{ uploadId: string; r2Key: string; publicUrl: string }> {
  assertUploadPolicy(input);
  const r2Key = buildR2Key(input.purpose, ownerId);

  const inserted = await db
    .insert(uploads)
    .values({
      ownerId,
      r2Key,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      purpose: input.purpose,
      status: "pending",
    })
    .returning();
  const row = inserted[0]!;

  await putObject(r2Key, input.body, input.contentType);

  await db
    .update(uploads)
    .set({ status: "ready", confirmedAt: new Date() })
    .where(eq(uploads.id, row.id));

  return { uploadId: row.id, r2Key, publicUrl: r2KeyToPublicUrl(r2Key) };
}
