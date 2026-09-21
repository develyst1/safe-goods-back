CREATE TABLE "categories" (
	"id" integer PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name_th" text NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_kind_check" CHECK ("categories"."kind" IN ('IN_GAME','PHYSICAL'))
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "files_kind_check" CHECK ("files"."kind" IN ('SLIP','EVIDENCE'))
);
--> statement-breakpoint
CREATE TABLE "room_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "room_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"room_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_role" text NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "room_events_actor_role_check" CHECK ("room_events"."actor_role" IN ('BUYER','SELLER','ADMIN','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"status" text NOT NULL,
	"category_id" integer NOT NULL,
	"description" text NOT NULL,
	"price_mode" text NOT NULL,
	"fee_payer" text NOT NULL,
	"entered_price" integer NOT NULL,
	"base_price" integer NOT NULL,
	"fee" integer NOT NULL,
	"buyer_pays" integer NOT NULL,
	"seller_receives" integer NOT NULL,
	"fee_rate_percent" integer NOT NULL,
	"fee_minimum" integer NOT NULL,
	"opened_by_role" text NOT NULL,
	"buyer_id" uuid,
	"seller_id" uuid,
	"slip_file_id" uuid,
	"reject_reason" text,
	"payment_confirmed_at" timestamp with time zone,
	"courier" text,
	"tracking_number" text,
	"delivered_at" timestamp with time zone,
	"parcel_arrived_at" timestamp with time zone,
	"auto_release_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"released_by" text,
	"paid_out_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rooms_code_unique" UNIQUE("code"),
	CONSTRAINT "rooms_price_mode_check" CHECK ("rooms"."price_mode" IN ('FEE_ADDED','FEE_INCLUDED')),
	CONSTRAINT "rooms_fee_payer_check" CHECK ("rooms"."fee_payer" IN ('SELLER','BUYER','SPLIT')),
	CONSTRAINT "rooms_opened_by_role_check" CHECK ("rooms"."opened_by_role" IN ('BUYER','SELLER')),
	CONSTRAINT "rooms_released_by_check" CHECK ("rooms"."released_by" IN ('BUYER','SYSTEM'))
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"fee_rate_percent" integer DEFAULT 20 NOT NULL,
	"fee_minimum" integer DEFAULT 20 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "settings_single_row" CHECK ("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"display_name" text NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" IN ('USER','ADMIN'))
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_events" ADD CONSTRAINT "room_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_room" ON "files" USING btree ("room_id","kind");--> statement-breakpoint
CREATE INDEX "room_events_room" ON "room_events" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "rooms_status_auto_release" ON "rooms" USING btree ("status","auto_release_at");--> statement-breakpoint
CREATE INDEX "rooms_buyer" ON "rooms" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "rooms_seller" ON "rooms" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower" ON "users" USING btree (lower("email"));