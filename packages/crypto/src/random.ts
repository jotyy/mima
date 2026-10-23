// Where packages/crypto gets its randomness: IVs, salts and new key pairs. Only the test
// vectors replace it, through `withFixedRandom`, so that sealing and key wrapping can be
// checked byte for byte. The package doesn't export this module; nothing outside it can
// make vauly reuse an IV.

type Source = {
	bytes: (length: number) => Uint8Array<ArrayBuffer>;
	ecdhKeyPair: () => Promise<CryptoKeyPair>;
};

const system: Source = {
	bytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
	ecdhKeyPair: () =>
		crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
			"deriveBits",
		]),
};

let source = system;

export const random: Source = {
	bytes: (length) => source.bytes(length),
	ecdhKeyPair: () => source.ecdhKeyPair(),
};

/**
 * Runs `run` with randomness taken from these lists, in order, and checks that it used
 * every value and asked for the lengths given. Test vectors only.
 */
export async function withFixedRandom<T>(
	fixed: { bytes?: Uint8Array[]; ecdhKeyPairs?: CryptoKeyPair[] },
	run: () => Promise<T>,
): Promise<T> {
	const bytes = [...(fixed.bytes ?? [])];
	const pairs = [...(fixed.ecdhKeyPairs ?? [])];
	source = {
		bytes: (length) => {
			const next = bytes.shift();
			if (next?.length !== length) {
				throw new Error(`Expected ${length} fixed random bytes`);
			}
			return new Uint8Array(next);
		},
		ecdhKeyPair: async () => {
			const next = pairs.shift();
			if (!next) throw new Error("Expected a fixed key pair");
			return next;
		},
	};
	try {
		const result = await run();
		if (bytes.length > 0 || pairs.length > 0) {
			throw new Error("Fixed random values were left unused");
		}
		return result;
	} finally {
		source = system;
	}
}
