/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
} from "@simplewebauthn/server";

import { fromBase64Url, toBase64Url } from "./base64url";
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
	pubKeyCredParams: [
		{ type: "public-key", alg: -8 },
		{ type: "public-key", alg: -7 },
	],
	authenticatorSelection: { residentKey: "required" },
	extensions: { credProps: true },
};

describe("making a passkey", () => {
	test("a site accepts it, with no attestation, verified and backed up", async () => {
		const { passkey, credential } = await createPasskey(request, origin);
		const result = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: "acme.test",
		});
		expect(result.verified).toBe(true);
		expect(result.registrationInfo?.fmt).toBe("none");
		expect(result.registrationInfo?.userVerified).toBe(true);
		expect(result.registrationInfo?.credentialDeviceType).toBe("multiDevice");
		expect(result.registrationInfo?.credentialBackedUp).toBe(true);
		expect(result.registrationInfo?.credential.id).toBe(passkey.credentialId);
		expect(result.registrationInfo?.credential.counter).toBe(0);
		expect(credential.clientExtensionResults).toEqual({
			credProps: { rk: true },
		});
	});

	test("it keeps what vauly needs to sign in later", async () => {
		const now = new Date("2026-10-23T09:00:00Z");
		const { passkey, credential } = await createPasskey(request, origin, now);
		expect(passkey).toMatchObject({
			rpId: "acme.test",
			rpName: "Acme",
			userHandle: request.user.id,
			userName: "alex@acme.test",
			userDisplayName: "Alex",
			createdAt: "2026-10-23T09:00:00.000Z",
		});
		expect(fromBase64Url(passkey.credentialId)).toHaveLength(16);
		expect(credential.response.publicKeyAlgorithm).toBe(-7);
		// The private key never leaves in the response.
		expect(JSON.stringify(credential)).not.toContain(passkey.privateKey);
	});

	test("without an rp.id, the page's own host is the relying party", async () => {
		const { passkey } = await createPasskey(
			{ ...request, rp: { name: "Acme" } },
			origin,
		);
		expect(passkey.rpId).toBe("app.acme.test");
	});

	test("vauly only makes ES256 passkeys for this device", () => {
		expect(canCreate(request)).toBe(true);
		expect(
			canCreate({
				...request,
				pubKeyCredParams: [{ type: "public-key", alg: -257 }],
			}),
		).toBe(false);
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
	test("a site accepts the signature, with the counter at 0", async () => {
		const { passkey, credential } = await createPasskey(request, origin);
		const registered = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: "acme.test",
		});
		const stored = registered.registrationInfo?.credential;
		if (!stored) throw new Error("not registered");

		// Many times over, so a signature with a short r or s (DER drops leading zeroes,
		// and adds one when the top bit is set) turns up.
		for (let i = 0; i < 40; i++) {
			const next = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
			const assertion = await signIn(passkey, { challenge: next }, origin);
			const result = await verifyAuthenticationResponse({
				response: assertion,
				expectedChallenge: next,
				expectedOrigin: origin,
				expectedRPID: "acme.test",
				credential: stored,
			});
			expect(result.verified).toBe(true);
			expect(result.authenticationInfo.newCounter).toBe(0);
			expect(result.authenticationInfo.userVerified).toBe(true);
		}
	});

	test("the assertion names the account the passkey was made for", async () => {
		const { passkey } = await createPasskey(request, origin);
		const assertion = await signIn(passkey, { challenge }, origin);
		expect(assertion.response.userHandle).toBe(request.user.id);
		expect(assertion.id).toBe(passkey.credentialId);
	});

	test("a site rejects a signature made for another origin", async () => {
		const { passkey, credential } = await createPasskey(request, origin);
		const registered = await verifyRegistrationResponse({
			response: credential,
			expectedChallenge: challenge,
			expectedOrigin: origin,
			expectedRPID: "acme.test",
		});
		const stored = registered.registrationInfo?.credential;
		if (!stored) throw new Error("not registered");
		const assertion = await signIn(
			passkey,
			{ challenge },
			"https://acme.test.example.test",
		);
		await expect(
			verifyAuthenticationResponse({
				response: assertion,
				expectedChallenge: challenge,
				expectedOrigin: origin,
				expectedRPID: "acme.test",
				credential: stored,
			}),
		).rejects.toThrow();
	});

	test("only passkeys for the rpId, and in the allow list when there is one", async () => {
		const [a, b, other] = await Promise.all([
			createPasskey(request, origin),
			createPasskey(request, origin),
			createPasskey(
				{ ...request, rp: { id: "example.test" } },
				"https://example.test",
			),
		]);
		const all = [a.passkey, b.passkey, other.passkey];
		expect(usable(all, { challenge }, "acme.test")).toEqual([
			a.passkey,
			b.passkey,
		]);
		expect(
			usable(
				all,
				{ challenge, allowCredentials: [{ id: b.passkey.credentialId }] },
				"acme.test",
			),
		).toEqual([b.passkey]);
		expect(
			usable(
				all,
				{ challenge, allowCredentials: [{ id: other.passkey.credentialId }] },
				"acme.test",
			),
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

	test("only on secure pages, and never an IP address", () => {
		expect(rpProblem("http://acme.test", "acme.test")).toMatch("HTTPS");
		expect(rpProblem("https://192.0.2.1", "192.0.2.1")).not.toBeNull();
		expect(rpProblem("file:///tmp/a.html", "")).not.toBeNull();
		expect(rpProblem("not a url", "acme.test")).not.toBeNull();
	});
});

describe("what a page sends", () => {
	test("a create request is kept to what vauly uses", () => {
		const read = readCreateRequest({
			...request,
			rp: { id: "Acme.TEST", name: "Acme" },
			timeout: 60_000,
			extensions: { credProps: true, prf: { eval: { first: "AAAA" } } },
		});
		expect(read).toMatchObject({
			challenge,
			rp: { id: "acme.test", name: "Acme" },
			user: request.user,
			excludeCredentials: [],
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

	test("a sign-in request", () => {
		expect(
			readGetRequest({
				challenge,
				rpId: "acme.test",
				allowCredentials: [{ id: "AQID", type: "public-key", transports: [] }],
				userVerification: "required",
			}),
		).toEqual({
			challenge,
			rpId: "acme.test",
			allowCredentials: [{ id: "AQID", type: "public-key" }],
			extensions: undefined,
		});
		expect(readGetRequest({ challenge: 42 })).toBeNull();
		expect(readGetRequest({ challenge, allowCredentials: "AQID" })).toBeNull();
	});

	test("a passkey in an item, or nothing", async () => {
		const { passkey } = await createPasskey(request, origin);
		expect(readPasskey(passkey)).toEqual(passkey);
		expect(readPasskey({ ...passkey, privateKey: undefined })).toBeNull();
		expect(readPasskey("passkey")).toBeNull();
		expect(readPasskey(undefined)).toBeNull();
	});
});

describe("encodings", () => {
	test("base64url both ways", () => {
		const bytes = Uint8Array.of(0xfb, 0xff, 0x00, 0x3e, 0x3f);
		expect(toBase64Url(bytes)).toBe("-_8APj8");
		expect(fromBase64Url("-_8APj8")).toEqual(bytes);
	});

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
