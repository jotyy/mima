import { type Argon2, setArgon2 } from "@vauly/crypto";

// The extension's pages that take the master password (the popup and vauly's windows)
// derive the key with Argon2id, libsodium's WebAssembly. It loads only once someone
// unlocks; the manifest's CSP lets the extension's own pages compile it.

const failures = {
	memory:
		"This device ran out of memory while deriving your key. Close some tabs or apps, then try again.",
	blocked:
		"This browser stopped the code that derives your key from running. Check that the extension is up to date.",
	failed: "vauly couldn't derive your key here. Try again.",
};

const argon2: Argon2 = async (...input) => {
	const { argon2Failure, argon2id } = await import("@vauly/crypto/argon2");
	try {
		return await argon2id(...input);
	} catch (error) {
		throw new Error(failures[argon2Failure(error)]);
	}
};

setArgon2(argon2);
