import { securityTxt } from "@vauly/ui/lib/security-txt";
import type { APIRoute } from "astro";

/** Where researchers report a problem; every vauly instance serves the same, but its own. */
export const GET: APIRoute = ({ site }) =>
	new Response(
		securityTxt({
			canonical: new URL("/.well-known/security.txt", site).href,
		}),
	);
