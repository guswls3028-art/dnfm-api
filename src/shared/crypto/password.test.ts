import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, validatePasswordPolicy } from "./password.js";

describe("password policy", () => {
  it("rejects passwords below the minimum length", () => {
    const r = validatePasswordPolicy("12");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/최소/);
  });
  it("accepts 4 chars (운영 정책 — 학원 SaaS 호환 최소 길이)", () => {
    expect(validatePasswordPolicy("1234").ok).toBe(true);
  });
  it("accepts long passwords", () => {
    expect(validatePasswordPolicy("verysecurepasswordwithlongtext").ok).toBe(true);
  });
});

describe("password hash + verify roundtrip", () => {
  it("verifies the same plaintext against its hash", async () => {
    const hash = await hashPassword("dnfm-secret");
    expect(await verifyPassword("dnfm-secret", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});
