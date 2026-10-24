-- Reveals and copies of a custom field were logged with the field's label, which is part of
-- the item. Any detail that isn't one of the fields every item has, or a field's ID,
-- becomes "field", which the activity log shows as "a custom field".
UPDATE `event` SET `detail` = 'field'
WHERE `action` IN ('revealed', 'copied')
	AND `detail` IS NOT NULL
	AND `detail` NOT IN ('username', 'secret', 'one-time code', 'login', 'passkey', 'earlier password', 'earlier value', 'earlier private key', 'field')
	AND NOT (`detail` GLOB 'field:[a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9][a-z0-9]' AND length(`detail`) = 14);
