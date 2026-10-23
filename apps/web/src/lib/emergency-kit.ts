// The Emergency Kit: one printable page with what it takes to sign in again, and a blank
// line for the master password, which mima can't reset.

type KitDetails = {
	name: string;
	email: string;
	workspace: string;
	address: string;
};

const escapeHtml = (text: string) =>
	text.replace(
		/[&<>"']/g,
		(char) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				char
			] as string,
	);

export function emergencyKitHtml(kit: KitDetails, date = new Date()) {
	const row = (label: string, value: string) =>
		`<div class="row"><span class="label">${label}</span><span class="value">${value}</span></div>`;
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>mima Emergency Kit · ${escapeHtml(kit.email)}</title>
<style>
	* { box-sizing: border-box; }
	body { margin: 0; font: 15px/1.5 "IBM Plex Sans", system-ui, sans-serif; color: #111; background: #fff; }
	main { max-width: 640px; margin: 48px auto; padding: 0 24px; }
	h1 { font-size: 26px; font-weight: 500; margin: 0 0 4px; }
	.sub { color: #666; margin: 0 0 32px; }
	.card { border: 1px solid #ddd; border-radius: 12px; padding: 8px 20px; }
	.row { display: flex; gap: 16px; padding: 14px 0; border-bottom: 1px solid #eee; }
	.row:last-child { border-bottom: 0; }
	.label { width: 160px; flex-shrink: 0; color: #666; }
	.value { font-family: "IBM Plex Mono", ui-monospace, monospace; word-break: break-all; }
	.write { align-items: flex-end; }
	.blank { flex: 1; border-bottom: 1px solid #111; min-height: 40px; }
	h2 { font-size: 16px; font-weight: 500; margin: 32px 0 8px; }
	ul { margin: 0; padding-left: 20px; color: #333; }
	li { margin: 4px 0; }
	footer { margin-top: 40px; color: #888; font-size: 13px; }
	@media print { main { margin: 0 auto; } }
</style>
</head>
<body>
<main>
	<h1>mima Emergency Kit</h1>
	<p class="sub">For ${escapeHtml(kit.name)} in ${escapeHtml(kit.workspace)} · ${escapeHtml(date.toLocaleDateString(undefined, { dateStyle: "long" }))}</p>
	<div class="card">
		${row("Sign-in address", escapeHtml(kit.address))}
		${row("Email", escapeHtml(kit.email))}
		<div class="row write"><span class="label">Master password</span><span class="blank"></span></div>
	</div>
	<h2>Keep it safe</h2>
	<ul>
		<li>Write your master password above by hand, then keep this page where you keep your passport.</li>
		<li>Your master password can't be reset. Nobody at ${escapeHtml(kit.workspace)}, and nothing on the server, can open your private vault without it.</li>
		<li>If you lose it anyway, an admin can invite you again. You'll start with an empty private vault, and shared vaults can be opened to you again.</li>
	</ul>
	<footer>Printed from mima. This page holds no secret until you write one on it.</footer>
</main>
<script>window.addEventListener("load", () => window.print());</script>
</body>
</html>`;
}

const doneKey = (userId: string) => `mima.emergencyKit.${userId}`;

export function emergencyKitDone(userId: string) {
	try {
		return localStorage.getItem(doneKey(userId)) !== null;
	} catch {
		return false;
	}
}

/** Opens the kit in a new window, ready to print or save as PDF. */
export function openEmergencyKit(userId: string, kit: KitDetails) {
	const page = window.open("", "_blank");
	if (!page) return false;
	page.document.write(emergencyKitHtml(kit));
	page.document.close();
	try {
		localStorage.setItem(doneKey(userId), new Date().toISOString());
	} catch {
		// The kit still opened; the checklist just won't remember it.
	}
	return true;
}
