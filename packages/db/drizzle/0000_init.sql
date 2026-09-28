CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"tournament_id" uuid,
	"body" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"channels" text[] NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"display_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"venue_id" uuid,
	"edge_node_id" text,
	"actor_id" uuid,
	"actor_kind" text DEFAULT 'USER' NOT NULL,
	"device_id" uuid,
	"tournament_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"action" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text NOT NULL,
	"trigger" text DEFAULT 'SCHEDULE' NOT NULL,
	"requested_by" uuid,
	"file_name" text,
	"size_bytes" bigint,
	"offsite_status" text,
	"error" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"device_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'OTHER' NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"revoked_at" timestamp with time zone,
	"assigned_table_id" uuid,
	"last_seen_at" timestamp with time zone,
	"last_ip" text,
	"app_version" text,
	"user_agent" text,
	"current_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_type_ck" CHECK (type in ('ADMIN_PC', 'TD_TABLET', 'FLOOR_PHONE', 'DEALER_TABLET', 'CASHIER', 'REGISTRATION_DESK', 'DISPLAY', 'KIOSK', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "display_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"widgets" text[] NOT NULL,
	"theme" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "display_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"tournament_id" uuid,
	"display_template_id" uuid,
	"kind" text DEFAULT 'DISPLAY' NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "display_tokens_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "display_tokens_kind_ck" CHECK (kind in ('DISPLAY', 'KIOSK'))
);
--> statement-breakpoint
CREATE TABLE "entry_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"type" text NOT NULL,
	"chips" bigint DEFAULT 0 NOT NULL,
	"amount" bigint DEFAULT 0 NOT NULL,
	"voids_transaction_id" uuid,
	"voided" boolean DEFAULT false NOT NULL,
	"reason" text,
	"action_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_tx_type_ck" CHECK (type in ('BUY_IN', 'REBUY', 'ADD_ON', 'CHIP_ADJUSTMENT', 'BOUNTY_WON', 'VOID'))
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"params" jsonb,
	"file_id" uuid,
	"row_count" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "file_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "floor_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"seat_number" integer,
	"message" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_by" uuid,
	"device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	CONSTRAINT "floor_requests_kind_ck" CHECK (kind in ('CALL_FLOOR', 'BUST_REPORT')),
	CONSTRAINT "floor_requests_status_ck" CHECK (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED'))
);
--> statement-breakpoint
CREATE TABLE "house_rules_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"preset" text DEFAULT 'CUSTOM' NOT NULL,
	"config" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"filename" text NOT NULL,
	"file_id" uuid,
	"headers" text[] NOT NULL,
	"mapping" jsonb,
	"duplicate_strategy" text DEFAULT 'SKIP' NOT NULL,
	"preview" jsonb,
	"report" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"rows" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"triggered_by_tournament_id" uuid
);
--> statement-breakpoint
CREATE TABLE "leagues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"score_rule_id" uuid NOT NULL,
	"best_results_count" integer,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"player_id" uuid,
	"user_id" uuid,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"type" text NOT NULL,
	"player_id" uuid,
	"user_id" uuid,
	"recipient" text,
	"payload" jsonb NOT NULL,
	"dedupe_key" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	CONSTRAINT "notifications_status_ck" CHECK (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "one_time_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid,
	"tournament_id" uuid,
	"type" text NOT NULL,
	"client_operation_id" uuid NOT NULL,
	"request_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"affected_keys" text[] NOT NULL,
	"summary" text NOT NULL,
	"result_version" integer NOT NULL,
	"compensates_action_id" uuid,
	"compensated_by_action_id" uuid,
	"actor_id" uuid,
	"device_id" uuid,
	"edge_node_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"roles" text[] NOT NULL,
	"venue_ids" uuid[],
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"currency" text DEFAULT 'EUR' NOT NULL,
	"feature_flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notification_types" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"event_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"venue_id" uuid,
	"edge_node_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"entity_version" integer,
	"payload" jsonb NOT NULL,
	"realtime" jsonb,
	"syncable" boolean DEFAULT true NOT NULL,
	"sync_status" text DEFAULT 'PENDING' NOT NULL,
	"sync_attempts" integer DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone,
	"last_error" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_eventId_unique" UNIQUE("event_id"),
	CONSTRAINT "outbox_sync_status_ck" CHECK (sync_status in ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED'))
);
--> statement-breakpoint
CREATE TABLE "player_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"type" text NOT NULL,
	"granted" boolean NOT NULL,
	"source" text NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"body" text NOT NULL,
	"visibility" text DEFAULT 'STAFF' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "player_tag_links" (
	"player_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_tag_links_player_id_tag_id_pk" PRIMARY KEY("player_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "player_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"external_public_id" text NOT NULL,
	"member_number" text,
	"user_id" uuid,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"display_name" text NOT NULL,
	"nickname" text,
	"email" text,
	"phone" text,
	"avatar_file_id" uuid,
	"language" text,
	"country" text,
	"date_of_birth" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"source" text DEFAULT 'STAFF' NOT NULL,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"public_profile_enabled" boolean DEFAULT false NOT NULL,
	"kiosk_pin_hash" text,
	"search_text" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_status_ck" CHECK (status in ('ACTIVE', 'INACTIVE', 'BANNED', 'MERGED'))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"league_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seat_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"from_table_id" uuid,
	"from_table_number" integer,
	"from_seat" integer,
	"to_table_id" uuid,
	"to_table_number" integer,
	"to_seat" integer,
	"reason" text NOT NULL,
	"action_id" uuid,
	"confirmed_at" timestamp with time zone,
	"performed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"season_id" uuid,
	"name" text NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"organization_id" uuid,
	"device_id" uuid,
	"kind" text DEFAULT 'STAFF' NOT NULL,
	"csrf_token" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "structure_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"structure_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"type" text NOT NULL,
	"small_blind" bigint DEFAULT 0 NOT NULL,
	"big_blind" bigint DEFAULT 0 NOT NULL,
	"ante" bigint DEFAULT 0 NOT NULL,
	"ante_type" text DEFAULT 'NONE' NOT NULL,
	"duration_seconds" integer NOT NULL,
	"label" text,
	"note" text,
	CONSTRAINT "structure_levels_type_ck" CHECK (type in ('PLAY', 'BREAK')),
	CONSTRAINT "structure_levels_ante_ck" CHECK (ante_type in ('NONE', 'STANDARD', 'BIG_BLIND')),
	CONSTRAINT "structure_levels_duration_ck" CHECK (duration_seconds > 0)
);
--> statement-breakpoint
CREATE TABLE "sync_conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"local_version" integer,
	"remote_version" integer,
	"local_payload" jsonb,
	"remote_payload" jsonb,
	"reason" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"consumer" text PRIMARY KEY NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"token" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "system_kv" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_account_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"player_id" uuid,
	"user_id" uuid,
	"telegram_user_id" bigint NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"telegram_username" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "telegram_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"notification_id" uuid,
	"chat_id" bigint NOT NULL,
	"message_id" bigint,
	"status" text NOT NULL,
	"error" text,
	"http_status" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_integrations" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"bot_username" text,
	"encrypted_bot_token" text,
	"mode" text DEFAULT 'EDGE_LONG_POLLING' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DISABLED' NOT NULL,
	"last_update_id" bigint,
	"last_update_at" timestamp with time zone,
	"last_error" text,
	"staff_alerts_chat_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"player_id" uuid,
	"user_id" uuid,
	"token_hash" text NOT NULL,
	"telegram_user_id" bigint,
	"telegram_chat_id" bigint,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_tokenHash_unique" UNIQUE("token_hash"),
	CONSTRAINT "tg_link_tokens_kind_ck" CHECK (kind in ('DEEP_LINK', 'CODE'))
);
--> statement-breakpoint
CREATE TABLE "telegram_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"player_id" uuid,
	"topic" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "telegram_update_receipts" (
	"organization_id" uuid NOT NULL,
	"update_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	CONSTRAINT "telegram_update_receipts_organization_id_update_id_pk" PRIMARY KEY("organization_id","update_id")
);
--> statement-breakpoint
CREATE TABLE "tournament_clock_states" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"clock_status" text DEFAULT 'NOT_STARTED' NOT NULL,
	"current_level_id" uuid,
	"current_level_index" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"remaining_at_pause_ms" bigint,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"entry_number" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"eliminated_at" timestamp with time zone,
	"elimination_seq" integer,
	"eliminated_by_entry_id" uuid,
	"finish_position" integer,
	"voided_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entries_type_ck" CHECK (type in ('INITIAL', 'REENTRY')),
	CONSTRAINT "entries_status_ck" CHECK (status in ('ACTIVE', 'ELIMINATED', 'VOIDED'))
);
--> statement-breakpoint
CREATE TABLE "tournament_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"check_in_code" text NOT NULL,
	"waitlist_position" integer,
	"created_by" uuid,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_in_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registrations_status_ck" CHECK (status in ('RESERVED', 'REGISTERED', 'CHECKED_IN', 'WAITLISTED', 'PLAYING', 'ELIMINATED', 'CANCELLED', 'NO_SHOW'))
);
--> statement-breakpoint
CREATE TABLE "tournament_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"entries" integer DEFAULT 1 NOT NULL,
	"bounties" integer DEFAULT 0 NOT NULL,
	"points" jsonb,
	"prize_amount" bigint,
	"status" text DEFAULT 'PROVISIONAL' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_status_ck" CHECK (status in ('PROVISIONAL', 'FINALIZED'))
);
--> statement-breakpoint
CREATE TABLE "tournament_seat_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"seat_number" integer NOT NULL,
	"entry_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"present" boolean DEFAULT false NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "seat_status_ck" CHECK (status in ('ACTIVE', 'RELEASED'))
);
--> statement-breakpoint
CREATE TABLE "tournament_seat_locks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"table_id" uuid NOT NULL,
	"seat_number" integer NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_tournament_id" uuid,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_tables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tournament_id" uuid NOT NULL,
	"table_number" integer NOT NULL,
	"capacity" integer NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"dealer_button_seat" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "tables_status_ck" CHECK (status in ('OPEN', 'ACTIVE', 'BREAKING', 'CLOSED')),
	CONSTRAINT "tables_capacity_ck" CHECK (capacity between 2 and 11)
);
--> statement-breakpoint
CREATE TABLE "tournament_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb NOT NULL,
	"structure_id" uuid NOT NULL,
	"house_rules_profile_id" uuid,
	"display_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"series_id" uuid,
	"season_id" uuid,
	"template_id" uuid,
	"structure_id" uuid NOT NULL,
	"house_rules_profile_id" uuid,
	"house_rules" jsonb NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"game_type" text DEFAULT 'NLHE' NOT NULL,
	"format" text DEFAULT 'FREEZEOUT' NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"paused_from_status" text,
	"start_at" timestamp with time zone NOT NULL,
	"registration_open_at" timestamp with time zone,
	"registration_close_at" timestamp with time zone,
	"max_players" integer,
	"expected_players" integer,
	"starting_stack" bigint NOT NULL,
	"table_size" integer DEFAULT 9 NOT NULL,
	"buy_in" jsonb,
	"late_registration_policy" jsonb NOT NULL,
	"reentry_policy" jsonb NOT NULL,
	"rebuy_policy" jsonb NOT NULL,
	"addon_policy" jsonb NOT NULL,
	"bounty_policy" jsonb NOT NULL,
	"late_registration_closed" boolean DEFAULT false NOT NULL,
	"published" boolean DEFAULT false NOT NULL,
	"public_visibility" text DEFAULT 'PUBLIC' NOT NULL,
	"last_elimination_seq" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"finalized_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournaments_status_ck" CHECK (status in ('DRAFT', 'SCHEDULED', 'REGISTRATION_OPEN', 'SEATING', 'RUNNING', 'BREAK', 'PAUSED', 'HAND_FOR_HAND', 'FINISHED', 'FINALIZED', 'CANCELLED')),
	CONSTRAINT "tournaments_visibility_ck" CHECK (public_visibility in ('PUBLIC', 'UNLISTED', 'PRIVATE'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"is_super_admin" boolean DEFAULT false NOT NULL,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "venue_edge_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"node_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ONLINE' NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"software_version" text,
	"local_address" text,
	"last_seen_at" timestamp with time zone,
	"last_wan_seen_at" timestamp with time zone,
	"last_cloud_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_edge_nodes_nodeId_unique" UNIQUE("node_id"),
	CONSTRAINT "venue_edge_nodes_status_ck" CHECK (status in ('ONLINE', 'DEGRADED', 'OFFLINE', 'MAINTENANCE'))
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'Europe/Berlin' NOT NULL,
	"address" text,
	"local_hostname" text,
	"local_url" text,
	"public_url" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_current_user_id_users_id_fk" FOREIGN KEY ("current_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_templates" ADD CONSTRAINT "display_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "display_tokens" ADD CONSTRAINT "display_tokens_display_template_id_display_templates_id_fk" FOREIGN KEY ("display_template_id") REFERENCES "public"."display_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transactions" ADD CONSTRAINT "entry_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transactions" ADD CONSTRAINT "entry_transactions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transactions" ADD CONSTRAINT "entry_transactions_entry_id_tournament_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_transactions" ADD CONSTRAINT "entry_transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file_assets" ADD CONSTRAINT "file_assets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_requests" ADD CONSTRAINT "floor_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_requests" ADD CONSTRAINT "floor_requests_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "floor_requests" ADD CONSTRAINT "floor_requests_table_id_tournament_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tournament_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "house_rules_profiles" ADD CONSTRAINT "house_rules_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" ADD CONSTRAINT "leaderboard_snapshots_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_codes" ADD CONSTRAINT "one_time_codes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "one_time_codes" ADD CONSTRAINT "one_time_codes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_actions" ADD CONSTRAINT "operational_actions_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_consents" ADD CONSTRAINT "player_consents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_consents" ADD CONSTRAINT "player_consents_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_consents" ADD CONSTRAINT "player_consents_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_notes" ADD CONSTRAINT "player_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tag_links" ADD CONSTRAINT "player_tag_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tag_links" ADD CONSTRAINT "player_tag_links_tag_id_player_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."player_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_tags" ADD CONSTRAINT "player_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_rules" ADD CONSTRAINT "score_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_movements" ADD CONSTRAINT "seat_movements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_movements" ADD CONSTRAINT "seat_movements_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_movements" ADD CONSTRAINT "seat_movements_entry_id_tournament_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seat_movements" ADD CONSTRAINT "seat_movements_performed_by_users_id_fk" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "series" ADD CONSTRAINT "series_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_levels" ADD CONSTRAINT "structure_levels_structure_id_tournament_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."tournament_structures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_account_links" ADD CONSTRAINT "telegram_account_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_account_links" ADD CONSTRAINT "telegram_account_links_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_account_links" ADD CONSTRAINT "telegram_account_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_notification_id_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_integrations" ADD CONSTRAINT "telegram_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_tokens" ADD CONSTRAINT "telegram_link_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_subscriptions" ADD CONSTRAINT "telegram_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_update_receipts" ADD CONSTRAINT "telegram_update_receipts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_clock_states" ADD CONSTRAINT "tournament_clock_states_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_registration_id_tournament_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."tournament_registrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_entries" ADD CONSTRAINT "tournament_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_registrations" ADD CONSTRAINT "tournament_registrations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_results" ADD CONSTRAINT "tournament_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_results" ADD CONSTRAINT "tournament_results_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_results" ADD CONSTRAINT "tournament_results_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_assignments" ADD CONSTRAINT "tournament_seat_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_assignments" ADD CONSTRAINT "tournament_seat_assignments_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_assignments" ADD CONSTRAINT "tournament_seat_assignments_table_id_tournament_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tournament_tables"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_assignments" ADD CONSTRAINT "tournament_seat_assignments_entry_id_tournament_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."tournament_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_assignments" ADD CONSTRAINT "tournament_seat_assignments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_locks" ADD CONSTRAINT "tournament_seat_locks_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_seat_locks" ADD CONSTRAINT "tournament_seat_locks_table_id_tournament_tables_id_fk" FOREIGN KEY ("table_id") REFERENCES "public"."tournament_tables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_structures" ADD CONSTRAINT "tournament_structures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_tables" ADD CONSTRAINT "tournament_tables_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_structure_id_tournament_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."tournament_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_house_rules_profile_id_house_rules_profiles_id_fk" FOREIGN KEY ("house_rules_profile_id") REFERENCES "public"."house_rules_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_series_id_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."series"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_template_id_tournament_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."tournament_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_structure_id_tournament_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."tournament_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_house_rules_profile_id_house_rules_profiles_id_fk" FOREIGN KEY ("house_rules_profile_id") REFERENCES "public"."house_rules_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_edge_nodes" ADD CONSTRAINT "venue_edge_nodes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_edge_nodes" ADD CONSTRAINT "venue_edge_nodes_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_tournament_idx" ON "announcements" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_tournament_idx" ON "audit_logs" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_org_device_uq" ON "devices" USING btree ("organization_id","device_id");--> statement-breakpoint
CREATE INDEX "entry_tx_entry_idx" ON "entry_transactions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "entry_tx_tournament_idx" ON "entry_transactions" USING btree ("tournament_id");--> statement-breakpoint
CREATE INDEX "floor_requests_tournament_idx" ON "floor_requests" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "leaderboard_season_idx" ON "leaderboard_snapshots" USING btree ("season_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_player_uq" ON "notification_preferences" USING btree ("player_id","channel","type") WHERE "notification_preferences"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_prefs_user_uq" ON "notification_preferences" USING btree ("user_id","channel","type") WHERE "notification_preferences"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_uq" ON "notifications" USING btree ("organization_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_due_idx" ON "notifications" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "notifications_player_idx" ON "notifications" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE INDEX "otc_lookup_idx" ON "one_time_codes" USING btree ("organization_id","purpose","code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "op_actions_idempotency_uq" ON "operational_actions" USING btree ("organization_id","client_operation_id");--> statement-breakpoint
CREATE INDEX "op_actions_tournament_idx" ON "operational_actions" USING btree ("tournament_id","result_version");--> statement-breakpoint
CREATE INDEX "op_actions_keys_idx" ON "operational_actions" USING gin ("affected_keys");--> statement-breakpoint
CREATE UNIQUE INDEX "org_members_org_user_uq" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "outbox_sync_idx" ON "outbox_events" USING btree ("sync_status","seq");--> statement-breakpoint
CREATE INDEX "outbox_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","seq");--> statement-breakpoint
CREATE INDEX "player_consents_player_idx" ON "player_consents" USING btree ("player_id","type");--> statement-breakpoint
CREATE INDEX "player_notes_player_idx" ON "player_notes" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "player_tags_org_name_uq" ON "player_tags" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "players_public_id_uq" ON "players" USING btree ("external_public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "players_org_member_uq" ON "players" USING btree ("organization_id","member_number") WHERE "players"."member_number" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "players_org_email_uq" ON "players" USING btree ("organization_id","email") WHERE "players"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "players_org_user_uq" ON "players" USING btree ("organization_id","user_id") WHERE "players"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "players_org_idx" ON "players" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "players_search_idx" ON "players" USING btree ("organization_id","search_text");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_org_key_uq" ON "roles" USING btree (coalesce("organization_id", '00000000-0000-0000-0000-000000000000'::uuid),"key");--> statement-breakpoint
CREATE INDEX "seat_movements_tournament_idx" ON "seat_movements" USING btree ("tournament_id","created_at");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_device_idx" ON "sessions" USING btree ("device_id");--> statement-breakpoint
CREATE UNIQUE INDEX "structure_levels_pos_uq" ON "structure_levels" USING btree ("structure_id","position");--> statement-breakpoint
CREATE INDEX "sync_conflicts_open_idx" ON "sync_conflicts" USING btree ("resolved_at","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tg_links_org_tguser_active_uq" ON "telegram_account_links" USING btree ("organization_id","telegram_user_id") WHERE "telegram_account_links"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "tg_links_player_active_uq" ON "telegram_account_links" USING btree ("player_id") WHERE "telegram_account_links"."status" = 'ACTIVE' and "telegram_account_links"."player_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "tg_links_user_active_uq" ON "telegram_account_links" USING btree ("organization_id","user_id") WHERE "telegram_account_links"."status" = 'ACTIVE' and "telegram_account_links"."user_id" is not null;--> statement-breakpoint
CREATE INDEX "tg_deliveries_notification_idx" ON "telegram_deliveries" USING btree ("notification_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tg_subscriptions_uq" ON "telegram_subscriptions" USING btree ("organization_id","telegram_chat_id","topic");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_player_number_uq" ON "tournament_entries" USING btree ("tournament_id","player_id","entry_number");--> statement-breakpoint
CREATE UNIQUE INDEX "entries_one_active_uq" ON "tournament_entries" USING btree ("tournament_id","player_id") WHERE "tournament_entries"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "entries_tournament_idx" ON "tournament_entries" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_active_uq" ON "tournament_registrations" USING btree ("tournament_id","player_id") WHERE "tournament_registrations"."status" not in ('CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_checkin_code_uq" ON "tournament_registrations" USING btree ("check_in_code");--> statement-breakpoint
CREATE INDEX "registrations_tournament_idx" ON "tournament_registrations" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE INDEX "registrations_player_idx" ON "tournament_registrations" USING btree ("player_id");--> statement-breakpoint
CREATE UNIQUE INDEX "results_player_uq" ON "tournament_results" USING btree ("tournament_id","player_id");--> statement-breakpoint
CREATE INDEX "results_tournament_idx" ON "tournament_results" USING btree ("tournament_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_active_seat_uq" ON "tournament_seat_assignments" USING btree ("table_id","seat_number") WHERE "tournament_seat_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "seat_active_entry_uq" ON "tournament_seat_assignments" USING btree ("entry_id") WHERE "tournament_seat_assignments"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "seat_tournament_idx" ON "tournament_seat_assignments" USING btree ("tournament_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "seat_locks_uq" ON "tournament_seat_locks" USING btree ("table_id","seat_number");--> statement-breakpoint
CREATE INDEX "structures_org_idx" ON "tournament_structures" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tables_number_uq" ON "tournament_tables" USING btree ("tournament_id","table_number");--> statement-breakpoint
CREATE UNIQUE INDEX "tournaments_org_slug_uq" ON "tournaments" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "tournaments_venue_start_idx" ON "tournaments" USING btree ("venue_id","start_at");--> statement-breakpoint
CREATE INDEX "tournaments_status_idx" ON "tournaments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_org_slug_uq" ON "venues" USING btree ("organization_id","slug");