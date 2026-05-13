import bcrypt from "bcryptjs";
import { env } from "@/config/env.js";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function validatePasswordPolicy(plain: string): { ok: true } | { ok: false; reason: string } {
  if (plain.length < env.PASSWORD_MIN_LENGTH) {
    return { ok: false, reason: `최소 ${env.PASSWORD_MIN_LENGTH}자 이상이어야 합니다.` };
  }
  return { ok: true };
}
