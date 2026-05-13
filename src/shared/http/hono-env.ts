/**
 * Hono Context.Variables 타입 module augmentation.
 * c.set / c.get 의 key 별 타입을 전역 선언해서 라우트 핸들러에서 cast 없이 사용.
 */
import type { User } from "@/domains/auth/schema.js";
import type { SiteCode } from "@/shared/types/site.js";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    user: User;
    userId: string;
    site: SiteCode;
  }
}

// 이 파일은 import 만으로 declare 활성화. 별도 export 없음.
export {};
