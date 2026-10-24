import { describe, expect, test } from "bun:test";

import { newBackupPasswordProblem } from "./secrets";

describe("a backup's password", () => {
	const master = "correct horse battery staple 42";
	const strong = "maple orbit lantern quiet harbor seven";

	test("needs a master password's strength", () => {
		expect(newBackupPasswordProblem("", "", master)).toContain("Choose");
		expect(
			newBackupPasswordProblem("Tr0ub4dor&3", "Tr0ub4dor&3", master),
		).toContain("at least 12 characters");
		expect(
			newBackupPasswordProblem("passwordpassword", "passwordpassword", master),
		).toContain("easy to guess");
		expect(newBackupPasswordProblem(strong, strong, master)).toBeNull();
	});

	test("isn't the master password, however it's written", () => {
		expect(newBackupPasswordProblem(master, master, master)).toContain(
			"different password from your master password",
		);
		const composed = "café crème brûlée garden seven";
		const decomposed = composed.normalize("NFD");
		expect(
			newBackupPasswordProblem(decomposed, decomposed, composed),
		).toContain("different password");
	});

	test("is typed the same twice", () => {
		expect(newBackupPasswordProblem(strong, `${strong}!`, master)).toContain(
			"don't match",
		);
	});
});
