// Copies the repository's docs/ into the site, so the Markdown people read on GitHub is
// also the docs on the website. Each page's first heading becomes its title, links to
// other docs become site links, and links out of docs/ point at the file on GitHub.

import {
	copyFileSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

const REPOSITORY = "https://github.com/jotyy/mima";
const root = path.resolve(import.meta.dirname, "../../..");
const source = path.join(root, "docs");
const pages = path.resolve(import.meta.dirname, "../src/content/docs/docs");
const images = path.resolve(import.meta.dirname, "../public/docs/images");
// The landing page shows the same screenshots, optimized at build time.
const screens = path.resolve(import.meta.dirname, "../src/assets/screens");

rmSync(pages, { recursive: true, force: true });
rmSync(images, { recursive: true, force: true });
rmSync(screens, { recursive: true, force: true });
mkdirSync(pages, { recursive: true });
mkdirSync(images, { recursive: true });
mkdirSync(screens, { recursive: true });

const slugOf = (file: string) =>
	file === "README.md" ? "" : file.replace(/\.md$/, "");

/** A page's first paragraph, as plain text, for search results and link previews. */
function summary(body: string) {
	const paragraph =
		body
			.split(/\n\s*\n/)
			.map((block) => block.trim())
			.find((block) => block && !/^[#|`<>-]/.test(block)) ?? "";
	const text = paragraph
		.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
		.replace(/[*_`]/g, "")
		.replace(/\s+/g, " ");
	// Whole sentences, as many as fit a search result.
	let kept = "";
	for (const sentence of text.split(/(?<=[.!?])\s+/)) {
		if (kept && kept.length + sentence.length > 180) break;
		kept += `${sentence} `;
	}
	return kept.trim();
}

/**
 * On GitHub a diagram is the plain-text block after a `<!-- diagram: Name -->` comment;
 * on the site it's the component of that name, drawn properly, and the page becomes MDX.
 */
function drawDiagrams(body: string) {
	const used = new Set<string>();
	const mdx = body.replace(
		/<!-- diagram: (\w+) -->\s*```[^\n]*\n[\s\S]*?\n```/g,
		(_, name: string) => {
			used.add(name);
			return `<${name} />`;
		},
	);
	return { mdx, used: [...used] };
}

function rewriteLinks(body: string) {
	return body.replace(
		/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
		(match, bang: string, text: string, target: string) => {
			if (/^[a-z]+:|^#/i.test(target)) return match;
			const [file, hash] = target.split("#");
			const anchor = hash ? `#${hash}` : "";
			if (bang || file?.startsWith("images/"))
				return `${bang}[${text}](/docs/${file}${anchor})`;
			if (file && !file.includes("/") && file.endsWith(".md")) {
				const slug = slugOf(file);
				return `[${text}](/docs/${slug ? `${slug}/` : ""}${anchor})`;
			}
			// Anything else lives in the repository: show it on GitHub.
			const inRepo = path
				.relative(root, path.resolve(source, file ?? ""))
				.split(path.sep)
				.join("/");
			return `[${text}](${REPOSITORY}/blob/main/${inRepo}${anchor})`;
		},
	);
}

for (const file of readdirSync(source)) {
	if (!file.endsWith(".md")) continue;
	const raw = readFileSync(path.join(source, file), "utf8");
	const heading = /^# (.+)$/m.exec(raw);
	if (!heading?.[1]) throw new Error(`docs/${file} needs a "# Title" heading`);
	const body = rewriteLinks(raw.replace(heading[0], "").trim());
	const frontmatter = [
		"---",
		`title: ${JSON.stringify(heading[1])}`,
		`description: ${JSON.stringify(summary(body))}`,
		`editUrl: ${REPOSITORY}/edit/main/docs/${file}`,
		"---",
		"",
	].join("\n");
	const slug = slugOf(file) || "index";
	const { mdx, used } = drawDiagrams(body);
	const imports = used
		.map(
			(name) =>
				`import ${name} from "@/components/docs/diagrams/${name}.astro";`,
		)
		.join("\n");
	if (used.length)
		writeFileSync(
			path.join(pages, `${slug}.mdx`),
			`${frontmatter}${imports}\n\n${mdx}\n`,
		);
	else writeFileSync(path.join(pages, `${slug}.md`), `${frontmatter}${body}\n`);
}

for (const file of readdirSync(path.join(source, "images"))) {
	copyFileSync(path.join(source, "images", file), path.join(images, file));
	copyFileSync(path.join(source, "images", file), path.join(screens, file));
}
