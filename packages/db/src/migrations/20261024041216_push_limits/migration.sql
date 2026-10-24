ALTER TABLE `agent` ADD `notified_at` integer;--> statement-breakpoint
ALTER TABLE `push_subscription` ADD `failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- A database that ran the first version of the table may have more than one device on a session: keep the newest.
DELETE FROM `push_subscription` WHERE rowid NOT IN (SELECT max(rowid) FROM `push_subscription` GROUP BY `session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscription_session_idx` ON `push_subscription` (`session_id`);