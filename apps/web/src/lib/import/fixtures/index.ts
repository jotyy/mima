/// <reference types="bun" />

import { readFileSync } from "node:fs";
import { strToU8, zipSync } from "fflate";

// Made-up exports in each app's real layout, for the tests. The ZIP formats are packed
// here from their parts, so every fixture stays readable.

export const fixture = (name: string) =>
	new Uint8Array(readFileSync(`${import.meta.dir}/${name}`));

export const fixtureText = (name: string) =>
	new TextDecoder().decode(fixture(name));

/** 1Password's .1pux: the export, its attributes, a Document's file and an attachment. */
export const onePux = () =>
	zipSync({
		"export.attributes": strToU8(
			'{"version":3,"description":"1Password Unencrypted Export","timestamp":1700000000}',
		),
		"export.data": fixture("1password.json"),
		"files/d1__Contract.pdf": strToU8("not a real file"),
		"files/d2__recovery-codes.txt": strToU8("example recovery codes"),
	});

export const protonPassZip = () =>
	zipSync({ "Proton Pass/data.json": fixture("proton-pass.json") });

export const dashlaneZip = () =>
	zipSync(
		Object.fromEntries(
			[
				"credentials.csv",
				"securenotes.csv",
				"payments.csv",
				"ids.csv",
				"personalInfo.csv",
			].map((name) => [name, fixture(`dashlane/${name}`)]),
		),
	);
