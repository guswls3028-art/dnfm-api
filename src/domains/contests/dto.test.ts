import { describe, it, expect } from "vitest";
import { voteDto, selectForVoteDto, announceResultsDto } from "./dto.js";

describe("contest voteDto", () => {
  it("requires a valid uuid entryId", () => {
    expect(
      voteDto.safeParse({ entryId: "550e8400-e29b-41d4-a716-446655440000" }).success,
    ).toBe(true);
    expect(voteDto.safeParse({ entryId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("contest selectForVoteDto", () => {
  it("accepts boolean and defaults to true on empty payload", () => {
    const t = selectForVoteDto.safeParse({ selectedForVote: true });
    expect(t.success).toBe(true);
    const f = selectForVoteDto.safeParse({ selectedForVote: false });
    expect(f.success).toBe(true);
    // empty {} 도 통과 — `.default(true)` 정책 (select=true 가 흔한 동작이라 기본값).
    const empty = selectForVoteDto.safeParse({});
    expect(empty.success).toBe(true);
    if (empty.success) expect(empty.data.selectedForVote).toBe(true);
  });
  it("rejects non-boolean", () => {
    expect(selectForVoteDto.safeParse({ selectedForVote: "yes" }).success).toBe(false);
  });
});

describe("contest announceResultsDto", () => {
  it("accepts auto=true mode (no rankings needed)", () => {
    const auto = announceResultsDto.safeParse({ auto: true });
    expect(auto.success).toBe(true);
  });
  it("accepts manual rankings", () => {
    const manual = announceResultsDto.safeParse({
      rankings: [
        { entryId: "550e8400-e29b-41d4-a716-446655440000", rank: 1, note: "1등" },
      ],
    });
    expect(manual.success).toBe(true);
  });
  it("rejects auto=false with empty rankings", () => {
    const r = announceResultsDto.safeParse({ auto: false });
    expect(r.success).toBe(false);
  });
});
