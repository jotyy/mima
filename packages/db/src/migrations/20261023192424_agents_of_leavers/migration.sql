-- Agents whose owner was removed from the workspace before removal took their agents too.
-- Their grants and requests go first, in case foreign keys aren't enforced.
DELETE FROM `agent_grant` WHERE `agent_id` IN (SELECT `id` FROM `agent` WHERE `owner_id` NOT IN (SELECT `user_id` FROM `member`));--> statement-breakpoint
DELETE FROM `access_request` WHERE `agent_id` IN (SELECT `id` FROM `agent` WHERE `owner_id` NOT IN (SELECT `user_id` FROM `member`));--> statement-breakpoint
DELETE FROM `agent` WHERE `owner_id` NOT IN (SELECT `user_id` FROM `member`);
