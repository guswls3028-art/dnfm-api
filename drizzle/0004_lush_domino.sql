CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" varchar(16) NOT NULL,
	"target_type" varchar(16) NOT NULL,
	"target_id" uuid NOT NULL,
	"reporter_id" uuid,
	"anonymous_audit_hash" varchar(128),
	"reason" varchar(32) NOT NULL,
	"detail" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"resolution" varchar(32),
	"resolution_note" text,
	"moderator_memo" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_target_reporter_uniq" UNIQUE("site","target_type","target_id","reporter_id")
);
--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reports_site_target_idx" ON "reports" USING btree ("site","target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_site_status_idx" ON "reports" USING btree ("site","status","created_at");