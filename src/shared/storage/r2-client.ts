import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env.js";
import { AppError } from "../errors/app-error.js";

/**
 * Cloudflare R2 클라이언트.
 *
 * R2 는 S3 호환 API 라 @aws-sdk/client-s3 를 그대로 사용.
 *   - endpoint: https://<account_id>.r2.cloudflarestorage.com
 *   - region: "auto" (R2 는 region 무시)
 *   - access key / secret: R2 토큰 발급
 *
 * presigned PUT: 클라가 직접 R2 에 업로드 → 백엔드 부하 X.
 * presigned GET: 비공개 객체 임시 노출 (Stage 후속, 현재 대부분 public bucket 가정).
 */

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw AppError.internal("R2 not configured", "r2_not_configured");
  }
  cachedClient = new S3Client({
    region: env.R2_REGION,
    endpoint: env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // R2 호환을 위해 path-style 강제
    forcePathStyle: true,
  });
  return cachedClient;
}

function getBucket(): string {
  if (!env.R2_BUCKET) {
    throw AppError.internal("R2 not configured", "r2_not_configured");
  }
  return env.R2_BUCKET;
}

/**
 * presigned PUT URL — 클라가 이 URL 로 직접 PUT 업로드.
 * ttl(seconds) 미지정 시 env.R2_PRESIGN_TTL_SECONDS 사용.
 */
export async function getPresignedPutUrl(
  key: string,
  contentType: string,
  ttl?: number,
): Promise<string> {
  const client = getClient();
  const cmd = new PutObjectCommand({
    Bucket: getBucket(),
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, {
    expiresIn: ttl ?? env.R2_PRESIGN_TTL_SECONDS,
  });
}

/** presigned GET URL — 비공개 객체 임시 노출. */
export async function getPresignedGetUrl(
  key: string,
  ttl?: number,
): Promise<string> {
  const client = getClient();
  const cmd = new GetObjectCommand({
    Bucket: getBucket(),
    Key: key,
  });
  return getSignedUrl(client, cmd, {
    expiresIn: ttl ?? env.R2_PRESIGN_TTL_SECONDS,
  });
}

/** 객체 삭제. soft delete 정책 상 직접 호출은 cleanup job 에서만. */
export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucket(),
      Key: key,
    }),
  );
}
