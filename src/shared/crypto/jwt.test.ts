import { describe, it, expect, beforeAll } from "vitest";

// jwt module 은 env 를 import 한다. 테스트에서 env 가 throw 하지 않도록 사전 주입.
beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ?? "postgresql://dnfm:dnfm@localhost:5432/dnfm";
  process.env.JWT_ACCESS_SECRET =
    process.env.JWT_ACCESS_SECRET ?? "test-access-secret-must-be-at-least-32-chars-aaaa";
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET ?? "test-refresh-secret-must-be-at-least-32-chars-aaa";
});

describe("jwt sign + verify", () => {
  it("signs an access token and verifies sub + typ + ver", async () => {
    const { signAccessToken, verifyAccessToken } = await import("./jwt.js");
    const tok = signAccessToken("user-1", 7);
    const payload = verifyAccessToken(tok);
    expect(payload.sub).toBe("user-1");
    expect(payload.typ).toBe("access");
    expect(payload.ver).toBe(7);
  });

  it("signs a refresh token and verifies jti + typ", async () => {
    const { signRefreshToken, verifyRefreshToken } = await import("./jwt.js");
    const tok = signRefreshToken("user-2", "jti-abc");
    const payload = verifyRefreshToken(tok);
    expect(payload.sub).toBe("user-2");
    expect(payload.typ).toBe("refresh");
    expect(payload.jti).toBe("jti-abc");
  });

  it("rejects an access token when verified as refresh", async () => {
    const { signAccessToken, verifyRefreshToken } = await import("./jwt.js");
    const tok = signAccessToken("user-3", 0);
    expect(() => verifyRefreshToken(tok)).toThrow();
  });
});
