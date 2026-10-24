import {
	argon2idSeen,
	getConnection,
	rememberArgon2id,
	saveConnection,
	saveUnlocked,
} from "./storage";
import { TwoStepError, unlock, WrongPasswordError } from "./vault";

/**
 * Checks the master password and unlocks with it, as the popup does, for vauly's own
 * windows: it also counts as the person being verified just now. Returns what to tell
 * them when it didn't work, or null.
 */
export async function unlockWith(password: string): Promise<string | null> {
	if (!password) return "Enter your master password first.";
	try {
		const connection = await getConnection();
		const email = connection.email ?? "";
		const result = await unlock(
			{
				server: connection.server ?? "",
				email,
				token: connection.token || undefined,
			},
			password,
			undefined,
			// As in the popup: an account seen using Argon2id is never moved back to PBKDF2.
			await argon2idSeen(email),
		);
		if (result.argon2id) await rememberArgon2id(email);
		await saveConnection({ token: result.token });
		await saveUnlocked(result.privateKey, result.publicKey);
		return null;
	} catch (err) {
		if (err instanceof WrongPasswordError)
			return "That's not your master password.";
		if (err instanceof TwoStepError)
			return "Sign in again from vauly's button in the toolbar.";
		return (err as Error).message || "That didn't work";
	}
}
