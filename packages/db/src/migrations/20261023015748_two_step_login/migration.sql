ALTER TABLE `member` ADD `totp_secret` text;--> statement-breakpoint
ALTER TABLE `member` ADD `totp_pending` text;--> statement-breakpoint
ALTER TABLE `member` ADD `totp_step` integer;--> statement-breakpoint
ALTER TABLE `member` ADD `recovery_codes` text;