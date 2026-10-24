/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type WebAuthnCredential,
} from "@simplewebauthn/server";

import { toBase64Url } from "./base64url";
import {
	type CreateRequest,
	canCreate,
	cbor,
	createPasskey,
	derSignature,
	readCreateRequest,
	readGetRequest,
	readPasskey,
	rpProblem,
	signIn,
	usable,
	wantsVerification,
} from "./passkey";

// The passkeys vauly makes have to satisfy a real relying party, so each one goes through
// @simplewebauthn/server the way a site's sign-up and sign-in would check it.

const origin = "https://app.acme.test";
const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const request: CreateRequest = {
	challenge,
	rp: { id: "acme.test", name: "Acme" },
	user: {
		id: toBase64Url(new TextEncoder().encode("user-42")),
		name: "alex@acme.test",
		displayName: "Alex",
	},
	pubKeyCredParams: [{ type: "public-key", alg: -7 }],
	extensions: { credProps: true },
};
const verified = { verified: true };

async function register(made: Awaited<ReturnType<typeof createPasskey>>) {
	const result = await verifyRegistrationResponse({
		response: made.credential,
		expectedChallenge: challenge,
		expectedOrigin: origin,
		expectedRPID: "acme.test",
		requireUserVerification: false,
	});
	if (!result.registrationInfo) throw new Error("not registered");
	return { result, stored: result.registrationInfo.credential };
}

describe("making a passkey", () => {
	test("a site accepts it, with no attestation, verified and backed up", async () => {
		const made = await createPasskey(request, origin, verified);
		const { result } = await register(made);
		expect(result.verified).toBe(true);
		expect(result.registrationInfo?.fmt).toBe("none");
		expect(result.registrationInfo?.userVerified).toBe(true);
		expect(result.registrationInfo?.credentialDeviceType).toBe("multiDevice");
		expect(result.registrationInfo?.credentialBackedUp).toBe(true);
		expect(result.registrationInfo?.credential.id).toBe(
			made.passkey.credentialId,
		);
		expect(result.registrationInfo?.credential.counter).toBe(0);
		expect(made.credential.clientExtensionResults).toEqual({
			credProps: { rk: true },
		});
		// Used on this device only: not through a phone.
		expect(made.credential.response.transports).toEqual(["internal"]);
	});

	test("without the master password just now, it says the person wasn't verified", async () => {
		const made = await createPasskey(request, origin, { verified: false });
		const { result } = await register(made);
		expect(result.registrationInfo?.userVerified).toBe(false);
		await expect(
			verifyRegistrationResponse({
				response: made.credential,
				expectedChallenge: challenge,
				expectedOrigin: origin,
				expectedRPID: "acme.test",
			}),
		).rejects.toThrow();
	});

	test("it keeps what vauly needs to sign in later, and the key apart", async () => {
		const now = new Date("2026-10-23T09:00:00Z");
		const made = await createPasskey(request, origin, { verified: true, now });
		expect(made.passkey).toEqual({
			credentialId: made.passkey.credentialId,
			rpId: "acme.test",
			rpName: "Acme",
			userHandle: request.user.id,
			userName: "alex@acme.test",
			userDisplayName: "Alex",
			createdAt: "2026-10-23T09:00:00.000Z",
		});
		expect(made.privateKey.length).toBeGreaterThan(100);
		// The private key never leaves in the response.
		expect(JSON.stringify(made.credential)).not.toContain(
			toBase64Url(made.privateKey),
		);
	});

	test("without an rp.id, the page's own host is the relying party", async () => {
		const { passkey } = await createPasskey(
			{ ...request, rp: { name: "Acme" } },
			origin,
			verified,
		);
		expect(passkey.rpId).toBe("app.acme.test");
	});

	test("vauly only makes ES256 passkeys for this device", () => {
		expect(canCreate(request)).toBe(true);
		expect(canCreate({ ...request, pubKeyCredParams: [] })).toBe(false);
		expect(
			canCreate({
				...request,
				authenticatorSelection: { authenticatorAttachment: "cross-platform" },
			}),
		).toBe(false);
		// A site that wants a PRF secret from the passkey gets one from the browser.
		expect(canCreate({ ...request, extensions: { prf: true } })).toBe(false);
	});
});

describe("signing in", () => {
	async function stored() {
		const made = await createPasskey(request, origin, verified);
		return { ...made, stored: (await register(made)).stored };
	}
	const check = (
		response: Parameters<typeof verifyAuthenticationResponse>[0]["response"],
		next: string,
		credential: WebAuthnCredential,
		requireUserVerification = true,
	) =>
		verifyAuthenticationResponse({
			response,
			expectedChallenge: next,
			expectedOrigin: origin,
			expectedRPID: "acme.test",
			credential,
			requireUserVerification,
		});

	test("a site accepts the signature, with the counter at 0", async () => {
		const made = await stored();
		// Many times over, so a signature with a short r or s (DER drops leading zeroes,
		// and adds one when the top bit is set) turns up.
		for (let i = 0; i < 40; i++) {
			const next = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
			const assertion = await signIn(
				made.passkey,
				made.privateKey,
				{ challenge: next },
				origin,
				verified,
			);
			const result = await check(assertion, next, made.stored);
			expect(result.verified).toBe(true);
			expect(result.authenticationInfo.newCounter).toBe(0);
			expect(result.authenticationInfo.userVerified).toBe(true);
		}
	});

	test("unverified, a site that requires verification refuses it", async () => {
		const made = await stored();
		const assertion = await signIn(
			made.passkey,
			made.privateKey,
			{ challenge },
			origin,
			{ verified: false },
		);
		await expect(check(assertion, challenge, made.stored)).rejects.toThrow();
		const relaxed = await check(assertion, challenge, made.stored, false);
		expect(relaxed.authenticationInfo.userVerified).toBe(false);
	});

	test("the assertion names the account the passkey was made for", async () => {
		const made = await stored();
		const assertion = await signIn(
			made.passkey,
			made.privateKey,
			{ challenge },
			origin,
			verified,
		);
		expect(assertion.response.userHandle).toBe(request.user.id);
		expect(assertion.id).toBe(made.passkey.credentialId);
	});

	test("a site rejects a signature made for another origin", async () => {
		const made = await stored();
		const assertion = await signIn(
			made.passkey,
			made.privateKey,
			{ challenge },
			"https://acme.test.example.test",
			verified,
		);
		await expect(check(assertion, challenge, made.stored)).rejects.toThrow();
	});

	test("only passkeys for the rpId, and in the allow list when there is one", async () => {
		const [a, b, other] = await Promise.all([
			createPasskey(request, origin, verified),
			createPasskey(request, origin, verified),
			createPasskey(
				{ ...request, rp: { id: "example.test" } },
				"https://example.test",
				verified,
			),
		]);
		const all = [a.passkey, b.passkey, other.passkey].map((passkey) => ({
			...passkey,
			sealedKey: "",
		}));
		expect(usable(all, { challenge }, "acme.test")).toEqual(all.slice(0, 2));
		expect(
			usable(
				all,
				{ challenge, allowCredentials: [b.passkey.credentialId] },
				"acme.test",
			),
		).toEqual(all.slice(1, 2));
		// A list of other authenticators' credentials allows none of vauly's.
		expect(
			usable(all, { challenge, allowCredentials: [] }, "acme.test"),
		).toEqual([]);
	});
});

describe("which pages can use which passkeys", () => {
	test("a site's own host and its parents", () => {
		expect(rpProblem("https://acme.test", "acme.test")).toBeNull();
		expect(rpProblem("https://app.acme.test", "acme.test")).toBeNull();
		expect(
			rpProblem("https://login.app.acme.test", "app.acme.test"),
		).toBeNull();
		expect(rpProblem("https://acme.test:8443", "acme.test")).toBeNull();
		expect(rpProblem("http://localhost:3000", "localhost")).toBeNull();
	});

	test("never another site, a child or a lookalike", () => {
		expect(rpProblem("https://acme.test", "example.test")).not.toBeNull();
		expect(rpProblem("https://acme.test", "app.acme.test")).not.toBeNull();
		expect(rpProblem("https://notacme.test", "acme.test")).not.toBeNull();
		expect(
			rpProblem("https://acme.test.evil.test", "acme.test"),
		).not.toBeNull();
	});

	test("never a public suffix that many sites share", () => {
		expect(rpProblem("https://alice.github.io", "github.io")).toMatch(
			"shared by many sites",
		);
		expect(rpProblem("https://alice.github.io", "alice.github.io")).toBeNull();
		expect(rpProblem("https://www.example.co.uk", "co.uk")).not.toBeNull();
		expect(rpProblem("https://example.com", "com")).not.toBeNull();
	});

	test("only on secure pages, and never at an IP address", () => {
		expect(rpProblem("http://acme.test", "acme.test")).toMatch("HTTPS");
		expect(rpProblem("https://192.0.2.1", "192.0.2.1")).not.toBeNull();
		// The tail of an address looks like a domain, but isn't one.
		expect(rpProblem("https://192.168.1.1", "168.1.1")).not.toBeNull();
		expect(rpProblem("https://192.168.1.1", "1.1")).not.toBeNull();
		expect(rpProblem("https://[2001:db8::1]", "[2001:db8::1]")).not.toBeNull();
		expect(rpProblem("file:///tmp/a.html", "")).not.toBeNull();
		expect(rpProblem("null", "acme.test")).not.toBeNull();
	});
});

describe("what a page sends", () => {
	const ids = (n: number, bytes = 16) =>
		Array.from({ length: n }, () => ({
			type: "public-key",
			id: toBase64Url(crypto.getRandomValues(new Uint8Array(bytes))),
		}));

	test("a create request is kept to what vauly uses", () => {
		const read = readCreateRequest({
			...request,
			rp: { id: "Acme.TEST", name: "Acme" },
			pubKeyCredParams: [
				{ type: "public-key", alg: -8 },
				{ type: "public-key", alg: -7 },
				{ type: "public-key", alg: -257 },
			],
			authenticatorSelection: {
				residentKey: "required",
				userVerification: "required",
			},
			timeout: 60_000,
			extensions: {
				credProps: true,
				prf: { eval: { first: "AAAA" } },
				somethingElse: "x".repeat(10_000),
			},
		});
		expect(read).toEqual({
			challenge,
			rp: { id: "acme.test", name: "Acme" },
			user: request.user,
			pubKeyCredParams: [{ type: "public-key", alg: -7 }],
			excludeCredentials: [],
			authenticatorSelection: { userVerification: "required" },
			extensions: { credProps: true, prf: true },
		});
	});

	test("a create request without a challenge or user handle is refused", () => {
		expect(readCreateRequest({ ...request, challenge: "" })).toBeNull();
		expect(
			readCreateRequest({ ...request, user: { id: "not base64url!" } }),
		).toBeNull();
		// A user handle is at most 64 bytes.
		expect(
			readCreateRequest({
				...request,
				user: { id: toBase64Url(new Uint8Array(65)) },
			}),
		).toBeNull();
		expect(readCreateRequest({ ...request, rp: { id: 42 } })).toBeNull();
		expect(
			readCreateRequest({ ...request, excludeCredentials: [{ id: 1 }] }),
		).toBeNull();
		expect(readCreateRequest(null)).toBeNull();
	});

	test("oversized requests are refused or cut down", () => {
		expect(
			readCreateRequest({ ...request, challenge: "A".repeat(2000) }),
		).toBeNull();
		expect(
			readCreateRequest({
				...request,
				pubKeyCredParams: Array.from({ length: 33 }, () => ({
					type: "public-key",
					alg: -7,
				})),
			}),
		).toBeNull();
		expect(
			readCreateRequest({ ...request, excludeCredentials: ids(65) }),
		).toBeNull();
		expect(readGetRequest({ challenge, allowCredentials: ids(65) })).toBeNull();
		// Names are cut short, and credentials too long to be vauly's aren't kept.
		const read = readCreateRequest({
			...request,
			user: { ...request.user, name: "n".repeat(5000) },
			excludeCredentials: [...ids(2), ...ids(2, 900)],
		});
		expect(read?.user.name).toHaveLength(200);
		expect(read?.excludeCredentials).toHaveLength(2);
		expect(JSON.stringify(read).length).toBeLessThan(2000);
	});

	test("a sign-in request", () => {
		expect(
			readGetRequest({
				challenge,
				rpId: "acme.test",
				allowCredentials: [{ id: "AQID", type: "public-key", transports: [] }],
				userVerification: "discouraged",
			}),
		).toEqual({
			challenge,
			rpId: "acme.test",
			allowCredentials: ["AQID"],
			userVerification: "discouraged",
			extensions: undefined,
		});
		// No list, or an empty one, allows any passkey.
		expect(
			readGetRequest({ challenge, allowCredentials: [] })?.allowCredentials,
		).toBeUndefined();
		// A list of only other authenticators' long IDs allows none of vauly's.
		expect(
			readGetRequest({ challenge, allowCredentials: ids(1, 900) })
				?.allowCredentials,
		).toEqual([]);
		expect(readGetRequest({ challenge: 42 })).toBeNull();
		expect(readGetRequest({ challenge, allowCredentials: "AQID" })).toBeNull();
	});

	test("verification is wanted unless the site says it's discouraged", () => {
		expect(wantsVerification({ challenge })).toBe(true);
		expect(wantsVerification({ challenge, userVerification: "required" })).toBe(
			true,
		);
		expect(
			wantsVerification({ challenge, userVerification: "discouraged" }),
		).toBe(false);
		expect(wantsVerification(request)).toBe(true);
		expect(
			wantsVerification({
				...request,
				authenticatorSelection: { userVerification: "discouraged" },
			}),
		).toBe(false);
	});

	test("a passkey in an item, or nothing", async () => {
		const { passkey } = await createPasskey(request, origin, verified);
		const kept = { ...passkey, sealedKey: "AAAA.BBBB" };
		expect(readPasskey(kept)).toEqual(kept);
		expect(readPasskey(passkey)).toBeNull();
		expect(readPasskey("passkey")).toBeNull();
		expect(readPasskey(undefined)).toBeNull();
	});
});

describe("encodings", () => {
	test("CBOR as RFC 8949's examples have it", () => {
		const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
		expect(hex(cbor(10))).toBe("0a");
		expect(hex(cbor(500))).toBe("1901f4");
		expect(hex(cbor(-7))).toBe("26");
		expect(hex(cbor(-100))).toBe("3863");
		expect(hex(cbor("IETF"))).toBe("6449455446");
		expect(hex(cbor(Uint8Array.of(1, 2, 3, 4)))).toBe("4401020304");
		expect(hex(cbor(new Map([[1, 2]])))).toBe("a10102");
	});

	test("DER signatures pad a high bit and drop leading zeroes", () => {
		const raw = new Uint8Array(64);
		raw[0] = 0x80;
		raw[63] = 0x01;
		const der = derSignature(raw);
		expect(der[0]).toBe(0x30);
		// r: 33 bytes with a leading zero; s: a single byte.
		expect([...der.slice(2, 5)]).toEqual([0x02, 33, 0x00]);
		expect([...der.slice(-3)]).toEqual([0x02, 1, 0x01]);
	});
});
