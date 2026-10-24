CREATE TABLE `attachment` (
	`id` text PRIMARY KEY,
	`item_id` text NOT NULL,
	`meta` text,
	`size` integer NOT NULL,
	`chunks` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT `fk_attachment_item_id_item_id_fk` FOREIGN KEY (`item_id`) REFERENCES `item`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `attachment_chunk` (
	`attachment_id` text NOT NULL,
	`index` integer NOT NULL,
	`data` text NOT NULL,
	CONSTRAINT `attachment_chunk_pk` PRIMARY KEY(`attachment_id`, `index`),
	CONSTRAINT `fk_attachment_chunk_attachment_id_attachment_id_fk` FOREIGN KEY (`attachment_id`) REFERENCES `attachment`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `attachment_item_idx` ON `attachment` (`item_id`);