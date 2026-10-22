CREATE TABLE `access_request` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`item_id` text NOT NULL,
	`command` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_access_request_agent_id_agent_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_access_request_item_id_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `agent` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`public_key` text NOT NULL,
	`secret_hash` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`host` text,
	`expires_at` integer,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_grant` (
	`id` text PRIMARY KEY,
	`agent_id` text NOT NULL,
	`item_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`once` integer DEFAULT false NOT NULL,
	`expires_at` integer,
	`granted_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_agent_grant_agent_id_agent_id_fk` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_agent_grant_item_id_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `event` (
	`id` text PRIMARY KEY,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`action` text NOT NULL,
	`item_id` text,
	`vault_id` text,
	`subject_id` text,
	`detail` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `favorite` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	CONSTRAINT `favorite_pk` PRIMARY KEY(`user_id`, `item_id`),
	CONSTRAINT `fk_favorite_item_id_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invite` (
	`id` text PRIMARY KEY,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`token_hash` text NOT NULL UNIQUE,
	`invited_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`accepted_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item` (
	`id` text PRIMARY KEY,
	`vault_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`data` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_by` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_item_vault_id_vault_id_fk` FOREIGN KEY (`vault_id`) REFERENCES `vault`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `member` (
	`user_id` text PRIMARY KEY,
	`role` text NOT NULL,
	`kdf_salt` text NOT NULL,
	`kdf_iterations` integer NOT NULL,
	`public_key` text NOT NULL,
	`encrypted_private_key` text NOT NULL,
	`last_seen_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_member_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `vault` (
	`id` text PRIMARY KEY,
	`encrypted_meta` text NOT NULL,
	`personal_for` text,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vault_access` (
	`vault_id` text NOT NULL,
	`user_id` text NOT NULL,
	`wrapped_key` text NOT NULL,
	`granted_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `vault_access_pk` PRIMARY KEY(`vault_id`, `user_id`),
	CONSTRAINT `fk_vault_access_vault_id_vault_id_fk` FOREIGN KEY (`vault_id`) REFERENCES `vault`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_vault_access_user_id_member_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `member`(`user_id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `access_request_status_idx` ON `access_request` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grant_pair_idx` ON `agent_grant` (`agent_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `event_created_idx` ON `event` (`created_at`);--> statement-breakpoint
CREATE INDEX `item_vault_idx` ON `item` (`vault_id`);--> statement-breakpoint
CREATE INDEX `vault_access_user_idx` ON `vault_access` (`user_id`);