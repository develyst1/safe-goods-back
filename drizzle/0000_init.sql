CREATE TABLE `categories` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name_th` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_kind_check" CHECK("categories"."kind" IN ('IN_GAME','PHYSICAL'))
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`kind` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`file_name` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "files_kind_check" CHECK("files"."kind" IN ('SLIP','EVIDENCE'))
);
--> statement-breakpoint
CREATE INDEX `files_room` ON `files` (`room_id`,`kind`);--> statement-breakpoint
CREATE TABLE `room_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` text NOT NULL,
	`type` text NOT NULL,
	`actor_role` text NOT NULL,
	`actor_user_id` text,
	`note` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "room_events_actor_role_check" CHECK("room_events"."actor_role" IN ('BUYER','SELLER','ADMIN','SYSTEM'))
);
--> statement-breakpoint
CREATE INDEX `room_events_room` ON `room_events` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`status` text NOT NULL,
	`category_id` integer NOT NULL,
	`description` text NOT NULL,
	`price_mode` text NOT NULL,
	`fee_payer` text NOT NULL,
	`entered_price` integer NOT NULL,
	`base_price` integer NOT NULL,
	`fee` integer NOT NULL,
	`buyer_pays` integer NOT NULL,
	`seller_receives` integer NOT NULL,
	`fee_rate_percent` integer NOT NULL,
	`fee_minimum` integer NOT NULL,
	`opened_by_role` text NOT NULL,
	`buyer_id` text,
	`seller_id` text,
	`slip_file_id` text,
	`reject_reason` text,
	`payment_confirmed_at` text,
	`courier` text,
	`tracking_number` text,
	`delivered_at` text,
	`parcel_arrived_at` text,
	`auto_release_at` text,
	`released_at` text,
	`released_by` text,
	`paid_out_at` text,
	`completed_at` text,
	`cancelled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`buyer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`seller_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rooms_price_mode_check" CHECK("rooms"."price_mode" IN ('FEE_ADDED','FEE_INCLUDED')),
	CONSTRAINT "rooms_fee_payer_check" CHECK("rooms"."fee_payer" IN ('SELLER','BUYER','SPLIT')),
	CONSTRAINT "rooms_opened_by_role_check" CHECK("rooms"."opened_by_role" IN ('BUYER','SELLER')),
	CONSTRAINT "rooms_released_by_check" CHECK("rooms"."released_by" IN ('BUYER','SYSTEM'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_code_unique` ON `rooms` (`code`);--> statement-breakpoint
CREATE INDEX `rooms_status_auto_release` ON `rooms` (`status`,`auto_release_at`);--> statement-breakpoint
CREATE INDEX `rooms_buyer` ON `rooms` (`buyer_id`);--> statement-breakpoint
CREATE INDEX `rooms_seller` ON `rooms` (`seller_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`fee_rate_percent` integer DEFAULT 20 NOT NULL,
	`fee_minimum` integer DEFAULT 20 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL COLLATE NOCASE,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'USER' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('USER','ADMIN'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);