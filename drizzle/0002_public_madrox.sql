ALTER TABLE "comments" DROP CONSTRAINT "comments_author_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_nickname" varchar(32);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "author_password_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anonymous_marker" varchar(16);--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "anonymous_audit_hash" varchar(128);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "author_nickname" varchar(32);--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "author_password_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;