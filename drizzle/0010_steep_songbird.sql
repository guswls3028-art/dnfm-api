CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" varchar(16) NOT NULL,
	"actor_id" uuid,
	"action" varchar(64) NOT NULL,
	"target_type" varchar(64) NOT NULL,
	"target_id" varchar(128) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "status" varchar(16) DEFAULT 'submitted' NOT NULL;--> statement-breakpoint
UPDATE "contests" SET "status" = 'results' WHERE "status" = 'completed';--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "contest_entries" SET "status" = 'approved', "reviewed_at" = "created_at" WHERE "deleted_at" IS NULL;--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "status_reason" text;--> statement-breakpoint
ALTER TABLE "contest_entries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "contest_results" ADD COLUMN "award_name" varchar(80);--> statement-breakpoint
ALTER TABLE "contest_results" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_site_target_idx" ON "audit_logs" USING btree ("site","target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contest_entries_contest_status_idx" ON "contest_entries" USING btree ("contest_id","status");
