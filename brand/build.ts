// Builds every Vauly logo and icon from the artwork in packages/ui/src/lib/brand.ts:
// SVGs and PNGs in brand/, and the copies the web app, the website and the extension
// serve. Run `bun run brand` after changing the artwork or its colors.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

import {
	ink,
	logoBox,
	markBox,
	markFacets,
	markGradients,
	whiteFacetOpacity,
	wordmark,
} from "../packages/ui/src/lib/brand";

const root = path.resolve(import.meta.dirname, "..");
const out = (...parts: string[]) => {
	const file = path.join(root, ...parts);
	mkdirSync(path.dirname(file), { recursive: true });
	return file;
};

type Facet = keyof typeof markFacets;
type MarkStyle = "color" | "white" | "mono";

// ── SVG ──────────────────────────────────────────────────────────────────────────────

function gradients(id: string) {
	return Object.entries(markGradients)
		.map(
			([facet, g]) =>
				`<linearGradient id="${id}-${facet}" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}" gradientUnits="userSpaceOnUse">${g.stops
					.map(
						([offset, color]) =>
							`<stop offset="${offset}" stop-color="${color}"/>`,
					)
					.join("")}</linearGradient>`,
		)
		.join("");
}

/** The four facets. White and mono keep the fold by giving the deep facets less ink. */
function mark(style: MarkStyle, id: string) {
	const fill = (facet: Facet) => {
		if (style === "color") return `fill="url(#${id}-${facet})"`;
		const color = style === "white" ? "#FFFFFF" : ink.light;
		const opacity = whiteFacetOpacity[facet];
		return style === "white"
			? `fill="${color}" fill-opacity="${opacity}"`
			: `fill="${color}" fill-opacity="${facet.startsWith("upper") ? 0.55 : 1}"`;
	};
	return (Object.keys(markFacets) as Facet[])
		.map((facet) => `<path d="${markFacets[facet]}" ${fill(facet)}/>`)
		.join("");
}

const box = (b: { x: number; y: number; width: number; height: number }) =>
	`${b.x} ${b.y} ${b.width} ${b.height}`;

function markSvg(style: MarkStyle) {
	const id = `vauly-${style}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(markBox)}" fill="none"><title>Vauly</title>${style === "color" ? `<defs>${gradients(id)}</defs>` : ""}${mark(style, id)}</svg>\n`;
}

function logoSvg(style: MarkStyle, text: string) {
	const id = `vauly-logo-${style}`;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(logoBox)}" fill="none"><title>vauly</title>${style === "color" ? `<defs>${gradients(id)}</defs>` : ""}${mark(style, id)}${wordmark.map((d) => `<path d="${d}" fill="${text}"/>`).join("")}</svg>\n`;
}

/** The logo that follows the reader's color scheme, for places that can't pick one. */
function adaptiveLogoSvg() {
	const id = "vauly-logo";
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box(logoBox)}" fill="none"><title>vauly</title><style>.ink{fill:${ink.light}}@media (prefers-color-scheme: dark){.ink{fill:${ink.dark}}}</style><defs>${gradients(id)}</defs>${mark("color", id)}${wordmark.map((d) => `<path class="ink" d="${d}"/>`).join("")}</svg>\n`;
}

/**
 * The app icon: the white mark on a tile of Vauly blue, lit from the top left like the
 * mark itself. `square` fills the whole canvas, for platforms that round the corners
 * themselves (iOS, Android's maskable icons); `scale` is how wide the mark sits.
 */
function iconSvg({ square = false, scale = 0.56 } = {}) {
	const size = 512;
	const radius = square ? 0 : 114;
	const width = size * scale;
	const unit = width / markBox.width;
	const height = markBox.height * unit;
	const x = (size - width) / 2 - markBox.x * unit;
	// A touch above center: the V's weight sits low.
	const y = (size - height) / 2 - size * 0.015 - markBox.y * unit;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" fill="none"><title>Vauly</title><defs>
<linearGradient id="tile" x1="0" y1="0" x2="${size}" y2="${size}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4C82FF"/><stop offset=".55" stop-color="#1F5BF9"/><stop offset="1" stop-color="#1340CC"/></linearGradient>
<radialGradient id="glow" cx="0" cy="0" r="1" gradientTransform="translate(150 40) rotate(55) scale(420 330)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF" stop-opacity=".28"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
</defs><rect width="${size}" height="${size}" rx="${radius}" fill="url(#tile)"/><rect width="${size}" height="${size}" rx="${radius}" fill="url(#glow)"/>${square ? "" : `<rect x=".75" y=".75" width="${size - 1.5}" height="${size - 1.5}" rx="${radius - 0.75}" stroke="#FFFFFF" stroke-opacity=".14" stroke-width="1.5"/>`}<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${unit.toFixed(4)})">${mark("white", "icon")}</g></svg>\n`;
}

const svgs: Record<string, string> = {
	"vauly-mark.svg": markSvg("color"),
	"vauly-mark-white.svg": markSvg("white"),
	"vauly-mark-mono.svg": markSvg("mono"),
	"vauly-logo.svg": logoSvg("color", ink.light),
	"vauly-logo-dark.svg": logoSvg("color", ink.dark),
	"vauly-logo-white.svg": logoSvg("white", "#FFFFFF"),
	"vauly-logo-mono.svg": logoSvg("mono", ink.light),
	"vauly-logo-adaptive.svg": adaptiveLogoSvg(),
	"vauly-icon.svg": iconSvg(),
	"vauly-icon-square.svg": iconSvg({ square: true }),
	"vauly-icon-maskable.svg": iconSvg({ square: true, scale: 0.46 }),
};
for (const [name, svg] of Object.entries(svgs))
	writeFileSync(out("brand/svg", name), svg);

// ── PNG and ICO ──────────────────────────────────────────────────────────────────────

const browser = await chromium.launch();
const page = await browser.newPage();

/** Renders an SVG at an exact pixel size, keeping transparency. */
async function png(svg: string, width: number, height = width) {
	await page.setViewportSize({ width, height });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`,
	);
	return page.screenshot({ omitBackground: true, type: "png" });
}

/**
 * The artwork at `inner` pixels in the middle of a transparent square of `size`, as the
 * Chrome Web Store wants its icon: 96 × 96 of 128 × 128, with 16 pixels all round.
 */
async function paddedPng(svg: string, size: number, inner: number) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<style>html,body{margin:0;background:transparent}svg{display:block;width:${inner}px;height:${inner}px;margin:${(size - inner) / 2}px}</style>${svg}`,
	);
	return page.screenshot({ omitBackground: true, type: "png" });
}

/** An .ico holding PNG images, which every current browser reads. */
function ico(images: { size: number; data: Uint8Array }[]) {
	const header = Buffer.alloc(6 + images.length * 16);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(images.length, 4);
	let offset = header.length;
	images.forEach(({ size, data }, index) => {
		const entry = 6 + index * 16;
		header.writeUInt8(size >= 256 ? 0 : size, entry);
		header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(data.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += data.length;
	});
	return Buffer.concat([
		header,
		...images.map((image) => Buffer.from(image.data)),
	]);
}

const icon = svgs["vauly-icon.svg"] as string;
const iconSizes = [16, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024];
const icons = new Map<number, Uint8Array>();
for (const size of iconSizes) {
	icons.set(size, await png(icon, size));
	writeFileSync(
		out("brand/png", `vauly-icon-${size}.png`),
		icons.get(size) as Uint8Array,
	);
}
for (const size of [64, 128, 256, 512, 1024]) {
	const height = Math.round((size * markBox.height) / markBox.width);
	writeFileSync(
		out("brand/png", `vauly-mark-${size}.png`),
		await png(svgs["vauly-mark.svg"] as string, size, height),
	);
}
for (const [name, file] of [
	["vauly-logo", "vauly-logo.svg"],
	["vauly-logo-dark", "vauly-logo-dark.svg"],
	["vauly-logo-white", "vauly-logo-white.svg"],
] as const) {
	const width = 1280;
	const height = Math.round((width * logoBox.height) / logoBox.width);
	writeFileSync(
		out("brand/png", `${name}-1280.png`),
		await png(svgs[file] as string, width, height),
	);
}
const apple = await png(svgs["vauly-icon-square.svg"] as string, 180);
const maskable = await png(svgs["vauly-icon-maskable.svg"] as string, 512);
writeFileSync(out("brand/png", "apple-touch-icon.png"), apple);
writeFileSync(out("brand/png", "vauly-icon-maskable-512.png"), maskable);
// The extension's 128 icon is also its icon in the Chrome Web Store and on the extensions
// page, both of which want the padding.
const storeIcon = await paddedPng(icon, 128, 96);
const favicon = ico(
	[16, 32, 48].map((size) => ({ size, data: icons.get(size) as Uint8Array })),
);
writeFileSync(out("brand/favicon.ico"), favicon);

await browser.close();

// ── Where they're served ─────────────────────────────────────────────────────────────

const copies: [string, string | Uint8Array][] = [
	// The web app: tab, iOS home screen and the PWA manifest.
	["apps/web/public/favicon.svg", icon],
	["apps/web/public/favicon.ico", favicon],
	["apps/web/public/apple-touch-icon.png", apple],
	["apps/web/public/pwa-64x64.png", icons.get(64) as Uint8Array],
	["apps/web/public/pwa-192x192.png", icons.get(192) as Uint8Array],
	["apps/web/public/pwa-512x512.png", icons.get(512) as Uint8Array],
	["apps/web/public/maskable-icon-512x512.png", maskable],
	["apps/web/public/logo.svg", svgs["vauly-logo-adaptive.svg"] as string],
	// The website, and the docs' header in each theme.
	["apps/site/public/favicon.svg", icon],
	["apps/site/public/favicon.ico", favicon],
	["apps/site/public/apple-touch-icon.png", apple],
	["apps/site/src/assets/logo-light.svg", svgs["vauly-logo.svg"] as string],
	["apps/site/src/assets/logo-dark.svg", svgs["vauly-logo-dark.svg"] as string],
	// The extension's toolbar icons, and the padded one for the store.
	...[16, 32, 48, 96].map(
		(size) =>
			[
				`apps/extension/public/icon/${size}.png`,
				icons.get(size) as Uint8Array,
			] as [string, Uint8Array],
	),
	["apps/extension/public/icon/128.png", storeIcon],
	["apps/extension/store/icon-128.png", storeIcon],
];
for (const [file, data] of copies) writeFileSync(out(file), data);

console.log(
	`Wrote ${Object.keys(svgs).length} SVGs, PNGs in brand/png, and ${copies.length} served copies.`,
);
