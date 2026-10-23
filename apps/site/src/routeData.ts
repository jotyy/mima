import { defineRouteMiddleware } from "@astrojs/starlight/route-data";

/**
 * Each docs page shares its own card, made by `bun run og` (src/pages/og/); other pages,
 * such as the 404, share the landing page's.
 */
export const onRequest = defineRouteMiddleware((context) => {
	const { entry, head } = context.locals.starlightRoute;
	const docs = entry.id.startsWith("docs");
	const image = new URL(`/social/${docs ? entry.id : "home"}.jpg`, context.site)
		.href;
	const alt = docs
		? `${entry.id === "docs" ? "Documentation" : entry.data.title} · vauly docs`
		: "vauly: the password manager your team owns";
	head.push(
		{ tag: "meta", attrs: { property: "og:image", content: image } },
		{
			tag: "meta",
			attrs: { property: "og:image:type", content: "image/jpeg" },
		},
		{ tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
		{ tag: "meta", attrs: { property: "og:image:height", content: "630" } },
		{ tag: "meta", attrs: { property: "og:image:alt", content: alt } },
		{ tag: "meta", attrs: { name: "twitter:image", content: image } },
		{ tag: "meta", attrs: { name: "twitter:image:alt", content: alt } },
	);
});
