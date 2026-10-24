import { describe, expect, test } from "bun:test";

import { decryptPush as decrypt } from "./receive";
import {
	encryptPush,
	fromBase64Url,
	newVapidKeys,
	toBase64Url,
	validKeys,
	vapidAuthorization,
} from "./web-push";

// RFC 8291, section 5 and Appendix A: the keys, the salt and the message that comes out.
const rfc = {
	plaintext: "When I grow up, I want to be a watermelon",
	senderPublic:
		"BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
	senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
	receiverPublic:
		"BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
	receiverPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
	auth: "BTBZMqHH6r4Tts7J_aSIgg",
	salt: "DGv6ra1nlYgDCS1FRnbzlw",
	result:
		"DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

/** A P-256 private key from its scalar and the public key it goes with. */
function privateJwk(d: string, publicKey: string): JsonWebKey {
	const point = fromBase64Url(publicKey);
	return {
		kty: "EC",
		crv: "P-256",
		x: toBase64Url(point.slice(1, 33)),
		y: toBase64Url(point.slice(33, 65)),
		d,
	};
}

describe("encryptPush", () => {
	test("matches RFC 8291's example byte for byte", async () => {
		const privateKey = await crypto.subtle.importKey(
			"jwk",
			privateJwk(rfc.senderPrivate, rfc.senderPublic),
			{ name: "ECDH", namedCurve: "P-256" },
			false,
			["deriveBits"],
		);
		const body = await encryptPush(
			new TextEncoder().encode(rfc.plaintext),
			{ p256dh: rfc.receiverPublic, auth: rfc.auth },
			{
				sender: { privateKey, publicKey: fromBase64Url(rfc.senderPublic) },
				salt: fromBase64Url(rfc.salt),
			},
		);
		expect(toBase64Url(body)).toBe(rfc.result);
	});

	test("a browser's keys open what it sends, with a new key and salt each time", async () => {
		const keys = { p256dh: rfc.receiverPublic, auth: rfc.auth };
		const message = new TextEncoder().encode('{"title":"CI deploy"}');
		const [first, second] = await Promise.all([
			encryptPush(message, keys),
			encryptPush(message, keys),
		]);
		expect(toBase64Url(first)).not.toBe(toBase64Url(second));
		const receiver = privateJwk(rfc.receiverPrivate, rfc.receiverPublic);
		expect(await decrypt(first, receiver, rfc.auth)).toBe(
			'{"title":"CI deploy"}',
		);
		expect(await decrypt(second, receiver, rfc.auth)).toBe(
			'{"title":"CI deploy"}',
		);
	});

	test("padding makes short and long messages the same size", async () => {
		const keys = { p256dh: rfc.receiverPublic, auth: rfc.auth };
		const receiver = privateJwk(rfc.receiverPrivate, rfc.receiverPublic);
		const short = '{"title":"A"}';
		const long = JSON.stringify({
			title: "A much longer agent name ".repeat(8),
		});
		const [a, b] = await Promise.all(
			[short, long].map((text) =>
				encryptPush(new TextEncoder().encode(text), keys, { padTo: 640 }),
			),
		);
		expect(a?.length).toBe(86 + 640 + 1 + 16);
		expect(b?.length).toBe(a?.length);
		expect(
			await decrypt(a as Uint8Array<ArrayBuffer>, receiver, rfc.auth),
		).toBe(short);
		expect(
			await decrypt(b as Uint8Array<ArrayBuffer>, receiver, rfc.auth),
		).toBe(long);
	});

	test("refuses a message that doesn't fit in one record", async () => {
		const keys = { p256dh: rfc.receiverPublic, auth: rfc.auth };
		await expect(encryptPush(new Uint8Array(3994), keys)).rejects.toThrow(
			"at most 3993 bytes",
		);
		expect((await encryptPush(new Uint8Array(3993), keys)).length).toBe(4096);
	});
});

describe("validKeys", () => {
	test("takes a browser's keys and nothing else", async () => {
		const good = { p256dh: rfc.receiverPublic, auth: rfc.auth };
		expect(await validKeys(good)).toBe(true);
		expect(await validKeys({ ...good, auth: "c2hvcnQ" })).toBe(false);
		expect(
			await validKeys({ ...good, p256dh: toBase64Url(new Uint8Array(65)) }),
		).toBe(false);
		expect(
			await validKeys({
				...good,
				p256dh: toBase64Url(new Uint8Array([4, ...new Uint8Array(64).fill(1)])),
			}),
		).toBe(false);
		expect(await validKeys({ ...good, p256dh: "not base64!" })).toBe(false);
	});
});

describe("vapidAuthorization", () => {
	test("a JWT for the push service that the public key verifies", async () => {
		const keys = await newVapidKeys();
		const now = Date.UTC(2026, 9, 23, 12);
		const header = await vapidAuthorization(
			"https://fcm.googleapis.com/fcm/send/abc123",
			keys,
			"https://vauly.example.test",
			now,
		);
		const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(
			header,
		);
		if (!match) throw new Error(`Not a VAPID header: ${header}`);
		const [, head = "", claims = "", signature = "", k] = match;
		expect(k).toBe(keys.publicKey);
		const decode = (part: string) =>
			JSON.parse(new TextDecoder().decode(fromBase64Url(part)));
		expect(decode(head)).toEqual({ typ: "JWT", alg: "ES256" });
		expect(decode(claims)).toEqual({
			aud: "https://fcm.googleapis.com",
			exp: now / 1000 + 12 * 60 * 60,
			sub: "https://vauly.example.test",
		});
		const publicKey = await crypto.subtle.importKey(
			"raw",
			fromBase64Url(keys.publicKey),
			{ name: "ECDSA", namedCurve: "P-256" },
			false,
			["verify"],
		);
		const verified = await crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			publicKey,
			fromBase64Url(signature),
			new TextEncoder().encode(`${head}.${claims}`),
		);
		expect(verified).toBe(true);
	});
});
