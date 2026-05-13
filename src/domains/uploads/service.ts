import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db/client.js";
import { uploads } from "./schema.js";
import { AppError } from "../../shared/errors/app-error.js";
import { getPresignedPutUrl } from "../../shared/storage/r2-client.js";
import { env } from "../../config/env.js";
import type { ConfirmUploadInput, CreatePresignedUrlInput } from "./dto.js";

/** r2Key → 공개 URL (R2_PUBLIC_BASE 설정 시). 없으면 null. */
export function r2KeyToPublicUrl(r2Key: string): string | null {
  if (!env.R2_PUBLIC_BASE) return null;
  return `${env.R2_PUBLIC_BASE.replace(/\/+$/, "")}/${r2Key}`;
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
): Promise<{ uploadId: string; putUrl: string; r2Key: string; publicUrl: string | null }> {
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
export async function confirmUpload(
  uploadId: string,
  ownerId: string,
  input: ConfirmUploadInput,
) {
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
    throw AppError.badRequest(
      "삭제된 업로드입니다.",
      "upload_deleted",
    );
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
