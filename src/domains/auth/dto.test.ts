import { describe, it, expect } from "vitest";
import { localSignupDto, localLoginDto, changePasswordDto, updateProfileDto } from "./dto.js";

describe("localSignupDto", () => {
  it("accepts minimum-viable signup payload", () => {
    const r = localSignupDto.safeParse({
      username: "newb_user1",
      password: "1234",
      displayName: "뉴비",
      acceptedTerms: true,
    });
    expect(r.success).toBe(true);
  });
  it("rejects username with special characters", () => {
    const r = localSignupDto.safeParse({
      username: "newb user!", // space + bang invalid
      password: "1234",
      displayName: "뉴비",
      acceptedTerms: true,
    });
    expect(r.success).toBe(false);
  });
  it("rejects short passwords", () => {
    const r = localSignupDto.safeParse({
      username: "abc",
      password: "1",
      displayName: "x",
      acceptedTerms: true,
    });
    expect(r.success).toBe(false);
  });
  it("rejects signup without terms acceptance", () => {
    const r = localSignupDto.safeParse({
      username: "newb_user1",
      password: "1234",
      displayName: "뉴비",
    });
    expect(r.success).toBe(false);
  });
  it("rejects signup with explicit false terms", () => {
    const r = localSignupDto.safeParse({
      username: "newb_user1",
      password: "1234",
      displayName: "뉴비",
      acceptedTerms: false,
    });
    expect(r.success).toBe(false);
  });
});

describe("localLoginDto", () => {
  it("accepts non-empty username + password", () => {
    expect(localLoginDto.safeParse({ username: "u", password: "p" }).success).toBe(true);
  });
  it("rejects blank password", () => {
    expect(localLoginDto.safeParse({ username: "u", password: "" }).success).toBe(false);
  });
});

describe("changePasswordDto + updateProfileDto", () => {
  it("changePasswordDto requires both fields with new length policy", () => {
    expect(
      changePasswordDto.safeParse({ currentPassword: "old", newPassword: "1234" }).success,
    ).toBe(true);
    expect(
      changePasswordDto.safeParse({ currentPassword: "old", newPassword: "1" }).success,
    ).toBe(false);
  });
  it("updateProfileDto allows partial updates", () => {
    expect(updateProfileDto.safeParse({}).success).toBe(true);
    expect(updateProfileDto.safeParse({ displayName: "new" }).success).toBe(true);
  });
});
