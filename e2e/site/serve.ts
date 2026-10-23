// Serves the built website (apps/site/dist) the way a static host would, for the site
// tests: /docs/ is docs/index.html, and anything missing is the 404 page.
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../apps/site/dist");
const port = Number(process.env.PORT ?? 4322);

Bun.serve({
	port,
	async fetch(request) {
		const { pathname } = new URL(request.url);
		const target = path.join(root, decodeURIComponent(pathname));
		if (!target.startsWith(root))
			return new Response("Not found", { status: 404 });
		for (const candidate of [target, path.join(target, "index.html")]) {
			const file = Bun.file(candidate);
			if ((await file.exists()) && !candidate.endsWith("/"))
				return new Response(file);
		}
		return new Response(Bun.file(path.join(root, "404.html")), { status: 404 });
	},
});
console.log(`Serving ${root} on http://localhost:${port}`);
