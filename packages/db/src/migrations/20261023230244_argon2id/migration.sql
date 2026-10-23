ALTER TABLE `member` ADD `kdf` text DEFAULT 'pbkdf2' NOT NULL;--> statement-breakpoint
ALTER TABLE `member` ADD `kdf_memory` integer;