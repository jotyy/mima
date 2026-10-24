/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { type BackupRow, backupFilePath, toBackupZip } from "../backup";
import { readImport } from ".";
import { fixtureText } from "./fixtures";

const MB = 1024 * 1024;

/**
 * The ZIP, with what `name` claims to unpack to changed in its central directory, which
 * is where fflate reads it from.
 */
function claiming(zip: Uint8Array, name: string, size: number) {
	const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const wanted = strToU8(name);
	for (let at = 0; at + 46 <= zip.length; at++) {
		if (view.getUint32(at, true) !== 0x02014b50) continue;
		const length = view.getUint16(at + 28, true);
		const found = zip.subarray(at + 46, at + 46 + length);
		if (
			found.length === wanted.length &&
			found.every((b, i) => b === wanted[i])
		) {
			view.setUint32(at + 24, size, true);
			return zip;
		}
	}
	throw new Error(`No ${name} in the ZIP`);
}

describe("what a ZIP may unpack to", () => {
	const bitwarden = strToU8(fixtureText("bitwarden.json"));

	test("an export that claims more than 256 MB is refused before it's unpacked", () => {
		const zip = zipSync({ "data.json": bitwarden });
		expect(readImport(zip).items.length).toBeGreaterThan(0);
		// Unpacked anyway, it would read as it is: only the claim is large.
		expect(() => readImport(claiming(zip, "data.json", 300 * MB))).toThrow(
			"more than 256 MB once it's unpacked",
		);
	});

	test("what it would read adds up", () => {
		const zip = zipSync({
			"data.json": bitwarden,
			"notes/readme.csv": strToU8("name\nexample"),
		});
		claiming(zip, "data.json", 200 * MB);
		claiming(zip, "notes/readme.csv", 100 * MB);
		expect(() => readImport(zip)).toThrow("more than 256 MB");
	});

	test("attachments don't count, and one past what's left stays behind", () => {
		const rows: BackupRow[] = [
			{
				vault: "Engineering",
				kind: "login",
				name: "Deploy",
				secret: "example-pass",
				files: [backupFilePath(1, "big.bin"), backupFilePath(2, "small.txt")],
			},
		];
		const zip = toBackupZip(
			"vauly-backup-2026-10-24.csv",
			rows,
			new Map([
				["files/1/big.bin", strToU8("claims to be big")],
				["files/2/small.txt", strToU8("small")],
			]),
		);
		claiming(zip, "files/1/big.bin", 300 * MB);
		const result = readImport(zip);
		expect(result.items.map((item) => item.name)).toEqual(["Deploy"]);
		const files = [...(result.files?.values() ?? [])].flat();
		expect(files.map((file) => file.name)).toEqual(["small.txt"]);
		expect(result.left.attachment).toBe(1);
	});
});
