import { sha256Hex } from "@vauly/crypto";

// The accounts this device has seen use Argon2id, as SHA-256 hashes of their emails, so
// a server that later asks one of them for PBKDF2 again is refused (refuseDowngrade).

const KEY = "vauly.argon2id";

function read(): string[] {
	try {
		const value = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(value)
			? value.filter((entry) => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

const idOf = (email: string) => sha256Hex(email.trim().toLowerCase());

export async function argon2idSeen(email: string) {
	return email ? read().includes(await idOf(email)) : false;
}

export async function rememberArgon2id(email: string) {
	if (!email) return;
	const id = await idOf(email);
	const seen = read();
	if (seen.includes(id)) return;
	try {
		localStorage.setItem(KEY, JSON.stringify([...seen, id]));
	} catch {
		// Private windows can refuse storage; then this device can't remember it.
	}
}
