/** The page researchers read before reporting: scope, safe harbor, what to expect. */
export const SECURITY_POLICY = "https://vauly.app/docs/security-policy/";

const DAY = 24 * 60 * 60 * 1000;

/**
 * /.well-known/security.txt (RFC 9116), for vauly.app and for every vauly instance: either
 * way, reports go privately to the project. Written when the site or the app is built, so
 * it expires about a year after the deploy that serves it.
 */
export function securityTxt({
	canonical,
	now = new Date(),
}: {
	/** Where this copy lives; only vauly.app's own copy says so. */
	canonical?: string;
	now?: Date;
} = {}) {
	const expires = new Date(now.getTime() + 360 * DAY);
	expires.setUTCHours(0, 0, 0, 0);
	return [
		"# vauly is an open-source password manager. Please report security problems to the",
		"# project privately, through GitHub, rather than in a public issue.",
		"Contact: https://github.com/jotyy/vauly/security/advisories/new",
		`Expires: ${expires.toISOString()}`,
		"Preferred-Languages: en",
		`Policy: ${SECURITY_POLICY}`,
		...(canonical ? [`Canonical: ${canonical}`] : []),
		"",
	].join("\n");
}
