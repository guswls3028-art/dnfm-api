CREATE TABLE "broadcast_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" varchar(16) NOT NULL,
	"user_id" uuid,
	"nickname" varchar(32),
	"category" varchar(40) DEFAULT 'general' NOT NULL,
	"content" text NOT NULL,
	"image_r2_key" varchar(512),
	"status" varchar(16) DEFAULT 'received' NOT NULL,
	"moderated_by" uuid,
	"moderation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "draw_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site" varchar(16) NOT NULL,
	"title" varchar(160) NOT NULL,
	"round_number" integer,
	"prize" varchar(200),
	"participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winners" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"winner_count" integer DEFAULT 1 NOT NULL,
	"executed_by" uuid,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "broadcast_questions" ADD CONSTRAINT "broadcast_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_questions" ADD CONSTRAINT "broadcast_questions_moderated_by_users_id_fk" FOREIGN KEY ("moderated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draw_sessions" ADD CONSTRAINT "draw_sessions_executed_by_users_id_fk" FOREIGN KEY ("executed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcast_questions_site_status_idx" ON "broadcast_questions" USING btree ("site","status","created_at");--> statement-breakpoint
CREATE INDEX "broadcast_questions_user_idx" ON "broadcast_questions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "draw_sessions_site_executed_idx" ON "draw_sessions" USING btree ("site","executed_at");--> statement-breakpoint
CREATE INDEX "draw_sessions_site_round_idx" ON "draw_sessions" USING btree ("site","round_number");