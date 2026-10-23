CREATE TABLE `share_link` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`data` text NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`max_views` integer,
	`views` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_share_link_item_id_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `share_link_item_idx` ON `share_link` (`item_id`);