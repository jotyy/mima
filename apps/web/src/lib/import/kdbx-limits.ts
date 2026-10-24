// What vauly's import lets a KeePass database ask for. A database names its own key
// derivation, and unpacks to whatever its contents add up to, so a small hostile file
// could otherwise ask for gigabytes and take the tab down. Read by the page, to refuse a
// file before asking for its password (kdbx-header.ts), and by the import worker, which
// checks again before and while it derives (kdbx-open.ts).

export const KDBX_LIMITS = {
	/** Argon2's memory, in KiB: 1 GiB. */
	memory: 1024 * 1024,
	passes: 100,
	lanes: 16,
	/** AES-KDF's rounds: about a minute on a slow laptop. */
	aesRounds: 200_000_000,
	/** The file itself, in bytes. */
	fileSize: 100 * 1024 * 1024,
	/** What its contents may unpack to, in bytes, all together. */
	unpacked: 256 * 1024 * 1024,
	/** A key file, in bytes: real ones are a few hundred. */
	keyFileSize: 32 * 1024 * 1024,
};

export const tooCostly = (what: string) =>
	`This database asks for ${what}, more than vauly's import allows. In KeePass, lower it under Database Settings › Security, save, and try again; or export to XML.`;

export const tooBig =
	"That database is bigger than vauly's import takes (100 MB). Export it to XML instead.";

export const unpacksTooBig =
	"This database holds more than 256 MB once it's unpacked, more than vauly's import allows. Remove its largest attachments in KeePass, save, and try again.";

export const keyFileTooBig =
	"That file is too big to be a key file (32 MB at most). Choose the database's key file.";
