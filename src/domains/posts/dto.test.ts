import { describe, it, expect } from "vitest";
import { createPostDto, votePostDto, listPostsQuery } from "./dto.js";

describe("createPostDto", () => {
  it("accepts a normal post", () => {
    const r = createPostDto.safeParse({
      title: "처음 시작하시는 분들께",
      body: "안녕하세요, 뉴비 훈련소입니다.",
    });
    expect(r.success).toBe(true);
  });
  it("rejects empty title or body", () => {
    expect(createPostDto.safeParse({ title: "", body: "x" }).success).toBe(false);
    expect(createPostDto.safeParse({ title: "x", body: "" }).success).toBe(false);
  });
  it("rejects more than 20 attachments", () => {
    const tooMany = Array.from({ length: 21 }).map((_, i) => `key/${i}`);
    const r = createPostDto.safeParse({
      title: "x",
      body: "y",
      attachmentR2Keys: tooMany,
    });
    expect(r.success).toBe(false);
  });
});

describe("votePostDto", () => {
  it("accepts recommend/downvote only (postVoteTypes enum)", () => {
    expect(votePostDto.safeParse({ voteType: "recommend" }).success).toBe(true);
    expect(votePostDto.safeParse({ voteType: "downvote" }).success).toBe(true);
    expect(votePostDto.safeParse({ voteType: "up" }).success).toBe(false);
    expect(votePostDto.safeParse({ voteType: "side" }).success).toBe(false);
  });
});

describe("listPostsQuery", () => {
  it("coerces page / pageSize from string", () => {
    const r = listPostsQuery.safeParse({ page: "2", pageSize: "30" });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.page).toBe(2);
      expect(r.data.pageSize).toBe(30);
    }
  });
  it("clamps pageSize at 50", () => {
    const r = listPostsQuery.safeParse({ pageSize: "200" });
    expect(r.success).toBe(false);
  });
});
