CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"supabase_uid" text,
	"discord_user_id" bigint,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid,
	"actor_id" text NOT NULL,
	"actor_email" text NOT NULL,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"reason" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bot_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"discord_channel_id" bigint NOT NULL,
	"channel_name" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"is_report_channel" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"role" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guilds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"discord_guild_id" bigint NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guilds_discord_guild_id_unique" UNIQUE("discord_guild_id")
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"discord_user_id" bigint NOT NULL,
	"discord_username" text NOT NULL,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"payload_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedup_key" text,
	"sent_to_discord" boolean DEFAULT false NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"payroll_record_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_idr" integer NOT NULL,
	"paid_at" timestamp with time zone DEFAULT now() NOT NULL,
	"admin_user_id" text NOT NULL,
	"admin_name" text NOT NULL,
	"method" text NOT NULL,
	"transaction_ref" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_reversal" boolean DEFAULT false NOT NULL,
	"reverses_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"payroll_record_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount_idr" integer NOT NULL,
	"reason" text NOT NULL,
	"authorized_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payroll_record_id" uuid NOT NULL,
	"report_chapter_id" uuid NOT NULL,
	"project_id" uuid,
	"chapter_number" integer NOT NULL,
	"role" text NOT NULL,
	"unit_rate_idr" integer NOT NULL,
	"amount_idr" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_by" text,
	"reopened_at" timestamp with time zone,
	"reopened_by" text,
	"reopen_reason" text
);
--> statement-breakpoint
CREATE TABLE "payroll_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"role" text NOT NULL,
	"rate_idr" integer NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payroll_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"translator_chapters" integer DEFAULT 0 NOT NULL,
	"editor_chapters" integer DEFAULT 0 NOT NULL,
	"solo_chapters" integer DEFAULT 0 NOT NULL,
	"total_chapters" integer DEFAULT 0 NOT NULL,
	"gross_amount_idr" integer DEFAULT 0 NOT NULL,
	"adjustment_amount_idr" integer DEFAULT 0 NOT NULL,
	"net_amount_idr" integer DEFAULT 0 NOT NULL,
	"paid_amount_idr" integer DEFAULT 0 NOT NULL,
	"remaining_amount_idr" integer DEFAULT 0 NOT NULL,
	"payment_status" text DEFAULT 'UNPAID' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processing_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"discord_channel_id" bigint NOT NULL,
	"channel_name" text DEFAULT '' NOT NULL,
	"last_message_id" bigint,
	"last_synced_at" timestamp with time zone,
	"sync_status" text DEFAULT 'IDLE' NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"guild_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"project_id" uuid,
	"chapter_number" integer NOT NULL,
	"role" text,
	"unit_rate_idr" integer DEFAULT 0 NOT NULL,
	"amount_idr" integer DEFAULT 0 NOT NULL,
	"approval_status" text NOT NULL,
	"duplicate_flag" boolean DEFAULT false NOT NULL,
	"duplicate_of_chapter_id" uuid,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before_json" jsonb,
	"after_json" jsonb,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"project_id" uuid,
	"discord_guild_id" bigint NOT NULL,
	"discord_channel_id" bigint NOT NULL,
	"discord_message_id" bigint NOT NULL,
	"discord_author_id" bigint NOT NULL,
	"author_username" text NOT NULL,
	"author_display_name" text NOT NULL,
	"raw_content" text NOT NULL,
	"mentions_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"message_url" text DEFAULT '' NOT NULL,
	"message_timestamp" timestamp with time zone NOT NULL,
	"parse_status" text NOT NULL,
	"parse_notes_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reports_discord_message_id_unique" UNIQUE("discord_message_id")
);
--> statement-breakpoint
CREATE TABLE "role_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"guild_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_settings" ADD CONSTRAINT "bot_settings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_mappings" ADD CONSTRAINT "channel_mappings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_payroll_record_id_payroll_records_id_fk" FOREIGN KEY ("payroll_record_id") REFERENCES "public"."payroll_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_report_chapter_id_report_chapters_id_fk" FOREIGN KEY ("report_chapter_id") REFERENCES "public"."report_chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_items" ADD CONSTRAINT "payroll_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_periods" ADD CONSTRAINT "payroll_periods_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_rates" ADD CONSTRAINT "payroll_rates_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_records" ADD CONSTRAINT "payroll_records_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_checkpoints" ADD CONSTRAINT "processing_checkpoints_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chapters" ADD CONSTRAINT "report_chapters_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chapters" ADD CONSTRAINT "report_chapters_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chapters" ADD CONSTRAINT "report_chapters_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chapters" ADD CONSTRAINT "report_chapters_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_chapters" ADD CONSTRAINT "report_chapters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_events" ADD CONSTRAINT "report_events_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_period_id_payroll_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."payroll_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_aliases" ADD CONSTRAINT "role_aliases_guild_id_guilds_id_fk" FOREIGN KEY ("guild_id") REFERENCES "public"."guilds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_entity" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_bot_settings_guild_key" ON "bot_settings" USING btree ("guild_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_channel_mappings_unique" ON "channel_mappings" USING btree ("guild_id","discord_channel_id","project_id");--> statement-breakpoint
CREATE INDEX "idx_channel_mappings_channel" ON "channel_mappings" USING btree ("discord_channel_id");--> statement-breakpoint
CREATE INDEX "idx_channel_mappings_project" ON "channel_mappings" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_employee_roles_member_role" ON "employee_roles" USING btree ("member_id","role");--> statement-breakpoint
CREATE INDEX "idx_employee_roles_member" ON "employee_roles" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_members_guild_discord" ON "members" USING btree ("guild_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_members_guild_discord" ON "members" USING btree ("guild_id","discord_user_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_payments_period" ON "payments" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "idx_payments_member" ON "payments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_payments_record" ON "payments" USING btree ("payroll_record_id");--> statement-breakpoint
CREATE INDEX "idx_pa_record" ON "payroll_adjustments" USING btree ("payroll_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pi_chapter" ON "payroll_items" USING btree ("report_chapter_id");--> statement-breakpoint
CREATE INDEX "idx_pi_record" ON "payroll_items" USING btree ("payroll_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payroll_periods_guild_key" ON "payroll_periods" USING btree ("guild_id","period_key");--> statement-breakpoint
CREATE INDEX "idx_payroll_periods_key" ON "payroll_periods" USING btree ("guild_id","year","month");--> statement-breakpoint
CREATE INDEX "idx_payroll_rates_active" ON "payroll_rates" USING btree ("guild_id","role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_pr_period_member" ON "payroll_records" USING btree ("period_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_pr_period" ON "payroll_records" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "idx_pr_member" ON "payroll_records" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_pr_status" ON "payroll_records" USING btree ("payment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_checkpoints_guild_channel" ON "processing_checkpoints" USING btree ("guild_id","discord_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_project_aliases_guild_alias" ON "project_aliases" USING btree ("guild_id","alias");--> statement-breakpoint
CREATE INDEX "idx_project_aliases_project" ON "project_aliases" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_projects_guild_slug" ON "projects" USING btree ("guild_id","slug");--> statement-breakpoint
CREATE INDEX "idx_projects_guild" ON "projects" USING btree ("guild_id");--> statement-breakpoint
CREATE INDEX "idx_rc_period" ON "report_chapters" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "idx_rc_member" ON "report_chapters" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_rc_project" ON "report_chapters" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_rc_role" ON "report_chapters" USING btree ("role");--> statement-breakpoint
CREATE INDEX "idx_rc_status" ON "report_chapters" USING btree ("approval_status");--> statement-breakpoint
CREATE INDEX "idx_rc_chapter_num" ON "report_chapters" USING btree ("chapter_number");--> statement-breakpoint
CREATE INDEX "idx_rc_dup_lookup" ON "report_chapters" USING btree ("guild_id","project_id","chapter_number","member_id","role");--> statement-breakpoint
CREATE INDEX "idx_report_events_report" ON "report_events" USING btree ("report_id");--> statement-breakpoint
CREATE INDEX "idx_reports_period" ON "reports" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "idx_reports_member" ON "reports" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_reports_project" ON "reports" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_reports_channel" ON "reports" USING btree ("discord_channel_id");--> statement-breakpoint
CREATE INDEX "idx_reports_msg" ON "reports" USING btree ("discord_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_role_aliases_guild_alias" ON "role_aliases" USING btree ("guild_id","alias");