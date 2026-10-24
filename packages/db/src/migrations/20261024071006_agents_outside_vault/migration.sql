-- An agent acts for the person who made it, so it may only use items in vaults they can
-- open. Moving an item didn't re-check that before, so grants and open requests of agents
-- whose owner can't open the item's vault are deleted.
DELETE FROM `agent_grant` WHERE NOT EXISTS (
	SELECT 1 FROM `agent`
	JOIN `item` ON `item`.`id` = `agent_grant`.`item_id`
	JOIN `vault_access` ON `vault_access`.`vault_id` = `item`.`vault_id` AND `vault_access`.`user_id` = `agent`.`owner_id`
	WHERE `agent`.`id` = `agent_grant`.`agent_id`
);--> statement-breakpoint
DELETE FROM `access_request` WHERE `status` = 'pending' AND NOT EXISTS (
	SELECT 1 FROM `agent`
	JOIN `item` ON `item`.`id` = `access_request`.`item_id`
	JOIN `vault_access` ON `vault_access`.`vault_id` = `item`.`vault_id` AND `vault_access`.`user_id` = `agent`.`owner_id`
	WHERE `agent`.`id` = `access_request`.`agent_id`
);
