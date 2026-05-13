import "../../shared/http/hono-env.js";
import { Hono, type Context } from "hono";
import { eq } from "drizzle-orm";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { db } from "../../shared/db/client.js";
import { users, type DnfProfile } from "./schema.js";
import {
  dnfOcrCaptureTypeSchema,
  dnfProfileSchema,
  type DnfOcrCaptureType,
  type DnfOcrResult,
} from "./dnf-profile.js";
import { normalizeClassName } from "./dnf-classes.js";
import { ok } from "../../shared/http/response.js";
import { requireAuth } from "../../shared/http/middleware/auth.js";
import { AppError } from "../../shared/errors/app-error.js";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * 던파 모바일 OCR endpoints.
 *
 * 흐름:
 *   1. POST /auth/dnf-profile/ocr/:type  (multipart 이미지)
 *      → Vision 으로 텍스트 추출 + 타입별 후처리 → DnfOcrResult 반환.
 *      → 운영 키 없으면 mock 반환 (응답에 source: "mock" 표시).
 *   2. (반복 가능) 3종 캡처 — basic_info / character_list / character_select
 *   3. POST /auth/dnf-profile/confirm  (JSON — 사용자 보정한 결과)
 *      → user.dnf_profile 업데이트 + verifiedBySelectScreen 결정.
 *
 * verifiedBySelectScreen 정책:
 *   2번 (character_list) 의 names ∩ 3번 (character_select) 의 names overlap
 *   비율이 50% 이상이면 true.
 */
const ocrRoutes = new Hono();

/* -------------------------------------------------------------------------- */
/* OCR 호출 chain                                                              */
/*   1. Gemini 2.0 Flash (env.GEMINI_API_KEY) — structured JSON 직접 받기.      */
/*      Cloud Vision 대비 ~30배 저렴. multimodal 이라 type 별 prompt 분기.    */
/*   2. Cloud Vision REST API (env.GOOGLE_VISION_API_KEY) — raw text + 후처리. */
/*   3. Cloud Vision SDK (env.GOOGLE_APPLICATION_CREDENTIALS) — 동일 후처리.   */
/*   4. mock — 키 모두 미설정.                                                 */
/* -------------------------------------------------------------------------- */

interface VisionTextResult {
  fullText: string;
  /** TEXT_DETECTION 의 첫 entry 외 나머지 — 라인/단어별 박스. fontSize 추정용. */
  blocks: Array<{ text: string; vertices: Array<{ x: number; y: number }> }>;
}

/* ---- Gemini Flash — 직접 structured JSON ---- */

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}

async function callGemini(
  type: DnfOcrCaptureType,
  buffer: Buffer,
  mime: string,
): Promise<DnfOcrResult> {
  const prompt = geminiPromptFor(type);
  const schema = geminiSchemaFor(type);
  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inlineData: { mimeType: mime || "image/jpeg", data: buffer.toString("base64") } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(env.GEMINI_API_KEY)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw AppError.internal(`Gemini API 실패: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { candidates?: GeminiCandidate[] };
  const rawJson = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch {
    throw AppError.internal("Gemini 응답 JSON 파싱 실패", "ocr_parse_failed");
  }

  if (type === "basic_info") {
    return {
      type,
      adventurerName: (parsed.adventurerName as string | undefined)?.trim() || undefined,
      raw: rawJson,
    };
  }
  if (type === "character_list") {
    const names = (parsed.characterNames as string[] | undefined) ?? [];
    return {
      type,
      characterNames: names.map((s) => s.trim()).filter(Boolean),
      raw: rawJson,
    };
  }
  // character_select
  const rawChars =
    (parsed.characters as Array<{ name?: string; klass?: string }> | undefined) ?? [];
  // klass 정규화 — 각성명 등으로 들어와도 baseClass 로 매핑.
  const characters = rawChars
    .map((c) => {
      const name = (c.name ?? "").trim();
      const klassRaw = (c.klass ?? "").trim();
      if (!name) return null;
      const entry = klassRaw ? normalizeClassName(klassRaw) : null;
      return { name, klass: entry?.baseClass ?? klassRaw };
    })
    .filter((x): x is { name: string; klass: string } => x !== null);
  return { type, characters, raw: rawJson };
}

function geminiPromptFor(type: DnfOcrCaptureType): string {
  if (type === "basic_info") {
    return (
      "이 이미지는 던전앤파이터 모바일 의 '모험단 기본정보' 화면이다." +
      " 화면 안에 있는 '모험단명' 한국어 텍스트만 정확히 추출해라." +
      " 캐릭터명·레벨·항마력·서버명은 무시. 모험단명만."
    );
  }
  if (type === "character_list") {
    return (
      "이 이미지는 던전앤파이터 모바일 의 '보유 캐릭터' 화면이다." +
      " 각 캐릭터 카드의 '캐릭터명' 만 추출해 배열로 반환해라." +
      " 레벨·항마력·직업명·UI 라벨(예: 정보, 모험단)은 캐릭명에서 제외." +
      " 캐릭명만 깨끗하게."
    );
  }
  return (
    "이 이미지는 던전앤파이터 모바일 의 '캐릭터 선택' 화면이다." +
    " 각 캐릭터의 (이름, 직업) 페어를 정확히 매칭해 배열로 반환해라." +
    " 직업명은 던파의 base class 또는 1차/2차 각성명 (예: 엘레멘탈마스터, 오버마인드, 검신, 베가본드, 카이저)." +
    " 레벨·항마력·UI 라벨은 무시. 같은 화면에 5개 이상일 수 있음."
  );
}

function geminiSchemaFor(type: DnfOcrCaptureType): unknown {
  if (type === "basic_info") {
    return {
      type: "object",
      properties: { adventurerName: { type: "string" } },
      required: ["adventurerName"],
    };
  }
  if (type === "character_list") {
    return {
      type: "object",
      properties: {
        characterNames: { type: "array", items: { type: "string" } },
      },
      required: ["characterNames"],
    };
  }
  return {
    type: "object",
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            klass: { type: "string" },
          },
          required: ["name", "klass"],
        },
      },
    },
    required: ["characters"],
  };
}

async function callVisionViaApiKey(base64: string): Promise<VisionTextResult> {
  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(env.GOOGLE_VISION_API_KEY)}`;
  const body = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "TEXT_DETECTION", maxResults: 50 }],
        imageContext: { languageHints: ["ko"] },
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw AppError.internal(`Vision API 실패: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    responses?: Array<{
      fullTextAnnotation?: { text?: string };
      textAnnotations?: Array<{
        description?: string;
        boundingPoly?: { vertices?: Array<{ x?: number; y?: number }> };
      }>;
    }>;
  };
  const r = data.responses?.[0];
  const fullText = r?.fullTextAnnotation?.text ?? r?.textAnnotations?.[0]?.description ?? "";
  const ann = r?.textAnnotations ?? [];
  // textAnnotations[0] 은 전체 텍스트 — skip
  const blocks = ann.slice(1).map((a) => ({
    text: a.description ?? "",
    vertices: (a.boundingPoly?.vertices ?? []).map((v) => ({
      x: v.x ?? 0,
      y: v.y ?? 0,
    })),
  }));
  return { fullText, blocks };
}

async function callVisionViaSdk(buffer: Buffer): Promise<VisionTextResult> {
  // 동적 import — SDK 미설치 환경에서도 컴파일 에러 안 나게.
  let vision: typeof import("@google-cloud/vision");
  try {
    vision = await import("@google-cloud/vision");
  } catch {
    throw AppError.internal(
      "Vision SDK 미설치 또는 import 실패. GOOGLE_VISION_API_KEY 사용 권장.",
      "vision_sdk_missing",
    );
  }
  const client = new vision.ImageAnnotatorClient();
  const [result] = await client.textDetection({ image: { content: buffer } });
  const fullText = result.fullTextAnnotation?.text ?? "";
  const ann = result.textAnnotations ?? [];
  const blocks = ann.slice(1).map((a) => ({
    text: a.description ?? "",
    vertices: (a.boundingPoly?.vertices ?? []).map((v) => ({
      x: v.x ?? 0,
      y: v.y ?? 0,
    })),
  }));
  return { fullText, blocks };
}

function isGeminiConfigured(): boolean {
  return Boolean(env.GEMINI_API_KEY);
}

function isVisionConfigured(): boolean {
  return Boolean(env.GOOGLE_VISION_API_KEY || env.GOOGLE_APPLICATION_CREDENTIALS);
}

function isAnyOcrConfigured(): boolean {
  return isGeminiConfigured() || isVisionConfigured();
}

async function runVision(buffer: Buffer): Promise<VisionTextResult> {
  if (env.GOOGLE_VISION_API_KEY) {
    return callVisionViaApiKey(buffer.toString("base64"));
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    return callVisionViaSdk(buffer);
  }
  throw AppError.internal("Vision 미설정", "vision_not_configured");
}

/* -------------------------------------------------------------------------- */
/* 캡처 type 별 후처리                                                        */
/* -------------------------------------------------------------------------- */

/**
 * basic_info — 모험단명 추출.
 *   휴리스틱: bounding box 높이가 가장 큰 텍스트 블록 (제목 텍스트가 보통 가장 큼).
 *   fallback: fullText 라인 중 한글 2~16자 라인 첫 줄.
 */
function extractAdventurerName(v: VisionTextResult): string | undefined {
  // bounding box height 로 정렬 — 가장 큰 텍스트가 모험단명일 가능성 높음.
  const sized = v.blocks
    .map((b) => {
      const ys = b.vertices.map((p) => p.y);
      const height = ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
      return { text: b.text.trim(), height };
    })
    .filter((b) => b.text.length >= 2 && b.text.length <= 16)
    .filter((b) => /[가-힣A-Za-z]/.test(b.text))
    .filter((b) => !/^(레벨|항마력|모험단|기본정보|정보|모험가)$/.test(b.text))
    .sort((a, b) => b.height - a.height);
  if (sized[0]) return sized[0].text;

  for (const line of v.fullText.split(/\r?\n/)) {
    const t = line.trim();
    if (t.length >= 2 && t.length <= 16 && /[가-힣]/.test(t) && !/^\d+$/.test(t)) {
      return t;
    }
  }
  return undefined;
}

const NOISE_LINE = /^(레벨|항마력|모험가|보유캐릭터|캐릭터|능력치|LV|Lv)/i;
const PURE_NUMBER = /^[\s\d,.]+$/;

/**
 * character_list — 캐릭 이름 후보.
 *   라인 단위로 fullText 훑어서 한글/영문 2~12자, 숫자/레벨 노이즈 제외.
 */
function extractCharacterNames(v: VisionTextResult): string[] {
  const lines = v.fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const line of lines) {
    if (PURE_NUMBER.test(line)) continue;
    if (NOISE_LINE.test(line)) continue;
    if (line.length < 2 || line.length > 12) continue;
    if (!/[가-힣A-Za-z]/.test(line)) continue;
    out.push(line);
  }
  // 중복 제거
  return [...new Set(out)];
}

/**
 * character_select — 캐릭 이름 + 직업 매핑.
 *   라인 순회하며 한 라인이 직업명(normalizeClassName 매칭)이면 직전 비-직업 라인을 캐릭명으로 본다.
 *   완벽한 layout 추론 X — 향후 box 좌표 기반 페어링으로 개선 필요.
 */
function extractCharacterWithClass(v: VisionTextResult): Array<{ name: string; klass: string }> {
  const lines = v.fullText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Array<{ name: string; klass: string }> = [];
  let pendingName: string | null = null;
  for (const line of lines) {
    if (PURE_NUMBER.test(line) || NOISE_LINE.test(line)) continue;
    const cls = normalizeClassName(line);
    if (cls) {
      if (pendingName) {
        out.push({ name: pendingName, klass: cls.baseClass });
        pendingName = null;
      }
      continue;
    }
    if (line.length >= 2 && line.length <= 12 && /[가-힣A-Za-z]/.test(line)) {
      pendingName = line;
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* multipart 이미지 추출                                                      */
/* -------------------------------------------------------------------------- */

async function readImage(c: Context): Promise<{ buffer: Buffer; mime: string }> {
  const ctype = c.req.header("content-type") ?? "";
  if (!ctype.includes("multipart/form-data")) {
    throw AppError.badRequest("multipart/form-data 가 필요합니다.", "invalid_content_type");
  }
  const form = await c.req.parseBody();
  const file = form.image ?? form.file;
  if (!(file instanceof File)) {
    throw AppError.badRequest("image 파일이 없습니다.", "image_required");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw AppError.badRequest("이미지 크기가 10MB 를 초과합니다.", "image_too_large");
  }
  const ab = await file.arrayBuffer();
  return { buffer: Buffer.from(ab), mime: file.type || "image/jpeg" };
}

/* -------------------------------------------------------------------------- */
/* mock — 키 미설정 시                                                        */
/* -------------------------------------------------------------------------- */

function buildMockResult(type: DnfOcrCaptureType): DnfOcrResult {
  if (type === "basic_info") {
    return {
      type,
      adventurerName: "광기의 파도",
      raw: "[MOCK] Vision 미설정 — 실제 캡처에서는 자동 추출됩니다.",
    };
  }
  if (type === "character_list") {
    return {
      type,
      characterNames: ["지금간다", "버서커형", "엘마지망생"],
      raw: "[MOCK] Vision 미설정",
    };
  }
  return {
    type,
    characters: [
      { name: "지금간다", klass: "버서커" },
      { name: "엘마지망생", klass: "엘레멘탈마스터" },
    ],
    raw: "[MOCK] Vision 미설정",
  };
}

/* -------------------------------------------------------------------------- */
/* POST /auth/dnf-profile/ocr/:type                                           */
/* -------------------------------------------------------------------------- */

ocrRoutes.post("/ocr/:type", requireAuth(), async (c) => {
  const rawType = c.req.param("type");
  const parsed = dnfOcrCaptureTypeSchema.safeParse(rawType);
  if (!parsed.success) {
    throw AppError.badRequest("지원하지 않는 캡처 타입입니다.", "invalid_capture_type", {
      type: rawType,
    });
  }
  const type = parsed.data;

  if (!isAnyOcrConfigured()) {
    const mock = buildMockResult(type);
    return ok(c, { result: mock, source: "mock" });
  }

  const { buffer, mime } = await readImage(c);

  // 1순위 — Gemini Flash (저렴 + multimodal structured JSON)
  if (isGeminiConfigured()) {
    try {
      const result = await callGemini(type, buffer, mime);
      return ok(c, { result, source: "gemini" });
    } catch (e) {
      logger.warn({ err: e }, "gemini call failed, falling back to vision");
      if (!isVisionConfigured()) {
        if (e instanceof AppError) throw e;
        throw AppError.internal("OCR 처리 중 오류가 발생했습니다.", "ocr_failed");
      }
      // fallthrough → Vision
    }
  }

  // 2순위 — Cloud Vision REST API or SDK + 후처리
  let visionResult: VisionTextResult;
  try {
    visionResult = await runVision(buffer);
  } catch (e) {
    logger.warn({ err: e }, "vision call failed");
    if (e instanceof AppError) throw e;
    throw AppError.internal("OCR 처리 중 오류가 발생했습니다.", "ocr_failed");
  }

  let result: DnfOcrResult;
  if (type === "basic_info") {
    result = {
      type,
      adventurerName: extractAdventurerName(visionResult),
      raw: visionResult.fullText,
    };
  } else if (type === "character_list") {
    result = {
      type,
      characterNames: extractCharacterNames(visionResult),
      raw: visionResult.fullText,
    };
  } else {
    result = {
      type,
      characters: extractCharacterWithClass(visionResult),
      raw: visionResult.fullText,
    };
  }
  return ok(c, { result, source: "vision" });
});

/* -------------------------------------------------------------------------- */
/* POST /auth/dnf-profile/confirm                                             */
/* -------------------------------------------------------------------------- */

/** 사용자 확정 dto — 본인이 OCR 결과를 수기 보정 후 저장. */
const confirmDto = z.object({
  adventurerName: z.string().trim().min(1).max(32).optional(),
  characters: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(32),
        klass: z.string().trim().min(1).max(32),
      }),
    )
    .max(50)
    .optional(),
  /** OCR 단계 결과 — verifiedBySelectScreen 계산에 사용. */
  characterListNames: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
  characterSelectNames: z.array(z.string().trim().min(1).max(32)).max(50).optional(),
  captureR2Keys: z
    .object({
      basicInfo: z.string().max(512).optional(),
      characterList: z.string().max(512).optional(),
      characterSelect: z.string().max(512).optional(),
    })
    .optional(),
});

/**
 * overlap 비율 — character_list ∩ character_select.
 *   분모: smaller set 크기 (한쪽이 적으면 overlap 보장 어려움).
 *   threshold: 0.5 (50%).
 */
function computeVerified(listNames: string[] = [], selectNames: string[] = []): boolean {
  const norm = (s: string) => s.replace(/\s+/g, "").trim();
  const a = new Set(listNames.map(norm).filter(Boolean));
  const b = new Set(selectNames.map(norm).filter(Boolean));
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const x of a) if (b.has(x)) overlap++;
  const denom = Math.min(a.size, b.size);
  return overlap / denom >= 0.5;
}

ocrRoutes.post("/confirm", requireAuth(), zValidator("json", confirmDto), async (c) => {
  const user = c.get("user");
  const input = c.req.valid("json");

  const verified = computeVerified(input.characterListNames, input.characterSelectNames);

  const nextProfile: DnfProfile = {
    ...(user.dnfProfile ?? {}),
    ...(input.adventurerName !== undefined && { adventurerName: input.adventurerName }),
    ...(input.characters !== undefined && { characters: input.characters }),
    verifiedBySelectScreen: verified,
    confirmedAt: new Date().toISOString(),
    ...(input.captureR2Keys !== undefined && {
      captureR2Keys: {
        ...(user.dnfProfile?.captureR2Keys ?? {}),
        ...input.captureR2Keys,
      },
    }),
  };

  // dnfProfile 자체 shape validation (defense-in-depth)
  const profileShape = dnfProfileSchema.partial().safeParse({
    adventurerName: nextProfile.adventurerName,
    characters: nextProfile.characters,
  });
  if (!profileShape.success) {
    throw AppError.unprocessable("프로필 형식이 올바르지 않습니다.", "invalid_profile");
  }

  const updated = await db
    .update(users)
    .set({ dnfProfile: nextProfile, updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();

  return ok(c, {
    dnfProfile: updated[0]?.dnfProfile ?? nextProfile,
    verifiedBySelectScreen: verified,
  });
});

export default ocrRoutes;
