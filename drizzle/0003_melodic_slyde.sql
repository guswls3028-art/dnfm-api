ALTER TABLE "contest_entries" ALTER COLUMN "author_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "author_nickname" varchar(32);--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "author_password_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "anonymous_marker" varchar(16);--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "anonymous_audit_hash" varchar(128);