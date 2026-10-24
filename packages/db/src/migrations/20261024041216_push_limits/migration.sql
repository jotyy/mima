ALTER TABLE `agent` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_session_idx` ON `push_subscription` (`session_id`);