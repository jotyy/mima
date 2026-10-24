-- Argon2's passes get a column of their own. kdf_iterations goes back to PBKDF2's rounds,
-- 600,000 for Argon2id accounts too: an app from before Argon2id reads only that, so it
-- derives slowly and fails, rather than send an auth key cheap to test guesses against.
ALTER TABLE `member` ADD `kdf_passes` integer;--> statement-breakpoint
UPDATE `member` SET `kdf_passes` = `kdf_iterations`, `kdf_iterations` = 600000 WHERE `kdf` = 'argon2id';
